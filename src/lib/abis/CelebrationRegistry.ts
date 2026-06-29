export const CelebrationRegistryAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "initialOwner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "relayerAddr",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadyClaimed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyLinked",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EditionsNotInitialized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EditionsSoldOut",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotAuthorized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotEligible",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotLinkedYet",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnknownCelebration",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "addr",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "status",
        "type": "bool"
      }
    ],
    "name": "AuthorizationUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "editionsAddr",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "CelebrationClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "workId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "editionsAddr",
        "type": "address"
      }
    ],
    "name": "CelebrationLinked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "enum CelebrationRegistry.CelebrationType",
        "name": "eventType",
        "type": "uint8"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "normieTokenId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "eligibleRecipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "sourceRef",
        "type": "bytes32"
      }
    ],
    "name": "CelebrationRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "authorized",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "celebrationCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "celebrations",
    "outputs": [
      {
        "internalType": "enum CelebrationRegistry.CelebrationType",
        "name": "eventType",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "normieTokenId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "eligibleRecipient",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "sourceRef",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "workId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "editionsAddr",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "claimed",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "registeredAt",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "eventRegistered",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      }
    ],
    "name": "getCelebration",
    "outputs": [
      {
        "components": [
          {
            "internalType": "enum CelebrationRegistry.CelebrationType",
            "name": "eventType",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "normieTokenId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "eligibleRecipient",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "sourceRef",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "workId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "editionsAddr",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "claimed",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "registeredAt",
            "type": "uint256"
          }
        ],
        "internalType": "struct CelebrationRegistry.Celebration",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      }
    ],
    "name": "isClaimable",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "enum CelebrationRegistry.CelebrationType",
        "name": "eventType",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "normieTokenId",
        "type": "uint256"
      }
    ],
    "name": "isEventRegistered",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "workId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "editionsAddr",
        "type": "address"
      }
    ],
    "name": "linkWork",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "enum CelebrationRegistry.CelebrationType",
        "name": "eventType",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "normieTokenId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "eligibleRecipient",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "sourceRef",
        "type": "bytes32"
      }
    ],
    "name": "registerCelebration",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "celebrationId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "addr",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "status",
        "type": "bool"
      }
    ],
    "name": "setAuthorized",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
