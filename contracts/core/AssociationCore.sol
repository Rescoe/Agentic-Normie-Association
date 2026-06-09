// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AssociationCore
 * @notice Canonical, immutable registry of the Agentic Normie Association.
 *
 *  Responsibilities (minimal by design):
 *   - Accept member registrations proven by relayer-signed EIP-712 attestations
 *   - Store the member registry (tokenId → Member)
 *   - Store institutional role assignments (role → RoleAssignment)
 *   - Authorize/revoke peripheral governance modules
 *   - Expose a clean, stable read interface for all peripheral contracts
 *
 *  What this contract does NOT do:
 *   - No cross-chain calls (Normies live on Ethereum mainnet; ANA lives on Base)
 *   - No voting logic (→ ConstituentAssembly)
 *   - No work creation (→ WorkRegistry)
 *   - No factory management (→ FactoryRegistry)
 *
 * @dev Implements IAssociationCore. Never deploy a proxy over this contract.
 *      If a module has a bug: redeploy the module, revoke old, authorize new.
 *      If this Core has a critical bug: deploy AssociationCoreV2 and migrate via events.
 */
contract AssociationCore is EIP712, Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct Member {
        address ownerAddress; // wallet that registered this Normie (on Base)
        uint256 registeredAt; // block.timestamp at inscription
        bool    active;
    }

    struct RoleAssignment {
        uint256 tokenId;       // Normie holding the role
        address holderAddress; // ownerAddress at assignment time
        uint256 assignedAt;    // block.timestamp
    }

    /**
     * @notice Attestation produced by the off-chain relayer to prove Normie ownership on mainnet.
     * @dev Signed as EIP-712 typed data. Each field contributes to the security of the proof:
     *   - tokenId / ownerAddress : what is being attested
     *   - targetChainId / targetAssociationCore : prevent re-use on another chain/contract
     *   - action : prevent re-use of a REGISTER attestation for future action types
     *   - nonce : single-use, anti-replay
     *   - deadline : short-lived, anti-frontrun
     */
    struct OwnershipAttestation {
        uint256 tokenId;
        address ownerAddress;
        uint256 targetChainId;
        address targetAssociationCore;
        bytes32 action;   // keccak256("REGISTER")
        uint256 nonce;
        uint256 deadline;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "OwnershipAttestation(uint256 tokenId,address ownerAddress,uint256 targetChainId,address targetAssociationCore,bytes32 action,uint256 nonce,uint256 deadline)"
    );

    /// @notice Attestation action identifier for member registration
    bytes32 public constant ACTION_REGISTER = keccak256("REGISTER");

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    string  public associationName;
    string  public associationSymbol;
    bytes32 public constitutionHash; // IPFS CIDv1 (set after constitution is uploaded)
    uint256 public foundedAt;

    /// @notice Address of the backend relayer allowed to sign attestations
    address public relayerAddress;

    mapping(uint256 tokenId  => Member)          public members;
    uint256[]                                     public memberTokenIds;

    mapping(bytes32 role     => RoleAssignment)  public roles;
    mapping(address module   => bool)            public authorizedModules;
    mapping(uint256 nonce    => bool)            public usedNonces;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event MemberRegistered(uint256 indexed tokenId, address indexed ownerAddress, uint256 timestamp);
    event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holderAddress);
    event ModuleAuthorized(address indexed module);
    event ModuleRevoked(address indexed module);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event ConstitutionSet(bytes32 indexed ipfsHash);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error AlreadyRegistered(uint256 tokenId);
    error WrongChain(uint256 expected, uint256 got);
    error WrongContract(address expected, address got);
    error WrongAction(bytes32 expected, bytes32 got);
    error AttestationExpired(uint256 deadline, uint256 current);
    error NonceAlreadyUsed(uint256 nonce);
    error CallerNotAttestedOwner(address caller, address attested);
    error InvalidRelayerSignature();
    error NotAuthorizedModule(address caller);
    error TokenIdNotMember(uint256 tokenId);
    error InvalidAddress();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyAuthorizedModule() {
        if (!authorizedModules[msg.sender]) revert NotAuthorizedModule(msg.sender);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        address _relayerAddress,
        string memory _name,
        string memory _symbol
    ) EIP712("ANACore", "1") Ownable(msg.sender) {
        if (_relayerAddress == address(0)) revert InvalidAddress();
        relayerAddress    = _relayerAddress;
        associationName   = _name;
        associationSymbol = _symbol;
        foundedAt         = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Registration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register a Normie as a member of the association.
     * @dev The caller must be the wallet that owns the Normie on Ethereum mainnet,
     *      proven by a relayer-signed EIP-712 attestation.
     *      Checks are ordered from cheapest to most expensive (gas optimisation).
     *
     * @param attestation  The signed ownership proof produced by the backend relayer
     * @param signature    ECDSA signature of the EIP-712 hash, signed by relayerAddress
     */
    function register(
        OwnershipAttestation calldata attestation,
        bytes calldata signature
    ) external {
        // 1. Binding checks (no SLOAD needed)
        if (attestation.targetChainId != block.chainid)
            revert WrongChain(block.chainid, attestation.targetChainId);

        if (attestation.targetAssociationCore != address(this))
            revert WrongContract(address(this), attestation.targetAssociationCore);

        if (attestation.action != ACTION_REGISTER)
            revert WrongAction(ACTION_REGISTER, attestation.action);

        // 2. Temporal validity
        if (block.timestamp > attestation.deadline)
            revert AttestationExpired(attestation.deadline, block.timestamp);

        // 3. Anti-replay nonce (SLOAD)
        if (usedNonces[attestation.nonce])
            revert NonceAlreadyUsed(attestation.nonce);

        // 4. Caller identity
        if (msg.sender != attestation.ownerAddress)
            revert CallerNotAttestedOwner(msg.sender, attestation.ownerAddress);

        // 5. Idempotency guard (SLOAD)
        if (members[attestation.tokenId].active)
            revert AlreadyRegistered(attestation.tokenId);

        // 6. Signature verification (most expensive — last)
        bytes32 structHash = keccak256(abi.encode(
            ATTESTATION_TYPEHASH,
            attestation.tokenId,
            attestation.ownerAddress,
            attestation.targetChainId,
            attestation.targetAssociationCore,
            attestation.action,
            attestation.nonce,
            attestation.deadline
        ));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != relayerAddress) revert InvalidRelayerSignature();

        // 7. Consume nonce (SSTORE — after all checks pass)
        usedNonces[attestation.nonce] = true;

        // 8. Register member
        members[attestation.tokenId] = Member({
            ownerAddress: msg.sender,
            registeredAt: block.timestamp,
            active:       true
        });
        memberTokenIds.push(attestation.tokenId);

        emit MemberRegistered(attestation.tokenId, msg.sender, block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Roles (written by authorized modules only)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Assign an institutional role to a registered Normie.
     * @dev Callable only by an authorized module (e.g. ConstituentAssembly).
     *      The owner of this contract cannot call this — governance is separate.
     */
    function grantRole(bytes32 role, uint256 tokenId) external onlyAuthorizedModule {
        if (!members[tokenId].active) revert TokenIdNotMember(tokenId);
        address holder = members[tokenId].ownerAddress;
        roles[role] = RoleAssignment({
            tokenId:       tokenId,
            holderAddress: holder,
            assignedAt:    block.timestamp
        });
        emit RoleGranted(role, tokenId, holder);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function authorizeModule(address module) external onlyOwner {
        if (module == address(0)) revert InvalidAddress();
        authorizedModules[module] = true;
        emit ModuleAuthorized(module);
    }

    function revokeModule(address module) external onlyOwner {
        authorizedModules[module] = false;
        emit ModuleRevoked(module);
    }

    /**
     * @notice Rotate the relayer signing key without redeploying the Core.
     * @dev Only use if the relayer private key is compromised.
     */
    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert InvalidAddress();
        emit RelayerUpdated(relayerAddress, newRelayer);
        relayerAddress = newRelayer;
    }

    function setConstitutionHash(bytes32 ipfsHash) external onlyOwner {
        constitutionHash = ipfsHash;
        emit ConstitutionSet(ipfsHash);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function isMember(uint256 tokenId) external view returns (bool) {
        return members[tokenId].active;
    }

    function getMemberOwner(uint256 tokenId) external view returns (address) {
        return members[tokenId].ownerAddress;
    }

    function getMemberCount() external view returns (uint256) {
        return memberTokenIds.length;
    }

    function getMemberTokenIds() external view returns (uint256[] memory) {
        return memberTokenIds;
    }

    function getRoleHolder(bytes32 role) external view returns (RoleAssignment memory) {
        return roles[role];
    }

    /// @notice Expose the EIP-712 domain separator (useful for frontend signing)
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
