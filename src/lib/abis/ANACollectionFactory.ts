export const ANACollectionFactoryAbi = [
  {
    "inputs": [
      { "internalType": "address", "name": "initialOwner",    "type": "address" },
      { "internalType": "address", "name": "relayerAddr",     "type": "address" },
      { "internalType": "address", "name": "associationAddr_","type": "address" },
      { "internalType": "address", "name": "platformAddr_",   "type": "address" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [], "name": "NotAuthorized", "type": "error" },
  { "inputs": [], "name": "PctOverflow",   "type": "error" },
  { "inputs": [], "name": "ZeroAddress",   "type": "error" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "uint256", "name": "normieTokenId",  "type": "uint256" },
      { "indexed": true,  "internalType": "address", "name": "collectionAddr", "type": "address" },
      { "indexed": false, "internalType": "string",  "name": "name",           "type": "string"  },
      { "indexed": false, "internalType": "address", "name": "minter",         "type": "address" }
    ],
    "name": "CollectionDeployed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "addr",   "type": "address" },
      { "indexed": false, "internalType": "bool",    "name": "status", "type": "bool"    }
    ],
    "name": "AuthorizationUpdated",
    "type": "event"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "normieTokenId",   "type": "uint256" },
      { "internalType": "string",  "name": "name",            "type": "string"  },
      { "internalType": "string",  "name": "symbol",          "type": "string"  },
      { "internalType": "address", "name": "minter_",         "type": "address" },
      { "internalType": "address", "name": "authorAddr_",     "type": "address" },
      { "internalType": "address", "name": "curatorAddr_",    "type": "address" },
      { "internalType": "address", "name": "rapporteurAddr_", "type": "address" },
      { "internalType": "uint8",   "name": "authorPct_",      "type": "uint8"   },
      { "internalType": "uint8",   "name": "curatorPct_",     "type": "uint8"   },
      { "internalType": "uint8",   "name": "rapporteurPct_",  "type": "uint8"   },
      { "internalType": "uint256", "name": "maxSupply_",      "type": "uint256" },
      { "internalType": "uint256", "name": "priceWei_",       "type": "uint256" }
    ],
    "name": "createCollection",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "normieTokenId", "type": "uint256" }],
    "name": "getCollectionsByNormie",
    "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "normieTokenId", "type": "uint256" }],
    "name": "getLastCollection",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllCollections",
    "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "authorized",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "associationAddr",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "platformAddr",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "defaultAuthorPct",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "defaultCuratorPct",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "defaultRapporteurPct",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "addr",   "type": "address" },
      { "internalType": "bool",    "name": "status", "type": "bool"    }
    ],
    "name": "setAuthorized",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "addr", "type": "address" }],
    "name": "setAssociationAddr",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "addr", "type": "address" }],
    "name": "setPlatformAddr",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint8", "name": "authorPct_",     "type": "uint8" },
      { "internalType": "uint8", "name": "curatorPct_",    "type": "uint8" },
      { "internalType": "uint8", "name": "rapporteurPct_", "type": "uint8" }
    ],
    "name": "setDefaultPct",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
