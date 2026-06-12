export const WorkRegistryAbi = [
  {
    "inputs": [{ "internalType": "address", "name": "_core", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [], "name": "EmptyContent", "type": "error" },
  { "inputs": [], "name": "InvalidCore", "type": "error" },
  {
    "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
    "name": "InvalidWorkId",
    "type": "error"
  },
  {
    "inputs": [{ "internalType": "address", "name": "caller", "type": "address" }],
    "name": "NotRapporteur",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "account", "type": "address" }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "tokenId", "type": "uint256" }
    ],
    "name": "ParticipantNotMember",
    "type": "error"
  },
  { "inputs": [], "name": "ScheduleNotActive", "type": "error" },
  {
    "inputs": [
      { "internalType": "uint256", "name": "nextAt", "type": "uint256" },
      { "internalType": "uint256", "name": "current", "type": "uint256" }
    ],
    "name": "TooEarly",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "nextCreationAt", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
      { "indexed": false, "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "name": "ScheduleSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "workId", "type": "uint256" }
    ],
    "name": "WorkArchived",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "workId", "type": "uint256" },
      { "indexed": false, "internalType": "string", "name": "content", "type": "string" },
      { "indexed": true, "internalType": "uint256", "name": "authorTokenId", "type": "uint256" },
      { "indexed": true, "internalType": "uint256", "name": "rapporteurTokenId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
    ],
    "name": "WorkPublished",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "sessionId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "initiatedAt", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "initiatedBy", "type": "address" }
    ],
    "name": "WorkSessionInitiated",
    "type": "event"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "workId", "type": "uint256" }],
    "name": "archive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "core",
    "outputs": [{ "internalType": "contract IAssociationCore", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
    "name": "getWork",
    "outputs": [
      {
        "components": [
          { "internalType": "uint256", "name": "id", "type": "uint256" },
          { "internalType": "string", "name": "content", "type": "string" },
          { "internalType": "uint256", "name": "authorTokenId", "type": "uint256" },
          { "internalType": "uint256", "name": "curatorTokenId", "type": "uint256" },
          { "internalType": "uint256", "name": "rapporteurTokenId", "type": "uint256" },
          { "internalType": "uint256", "name": "publishedAt", "type": "uint256" },
          { "internalType": "bool", "name": "archived", "type": "bool" }
        ],
        "internalType": "struct WorkRegistry.Work",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getSchedule",
    "outputs": [
      {
        "components": [
          { "internalType": "uint256", "name": "nextCreationAt", "type": "uint256" },
          { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
          { "internalType": "bool", "name": "active", "type": "bool" }
        ],
        "internalType": "struct WorkRegistry.CreationSchedule",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getWorkCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "initiateWorkSession",
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
    "inputs": [
      { "internalType": "string", "name": "content", "type": "string" },
      { "internalType": "uint256", "name": "authorTokenId", "type": "uint256" },
      { "internalType": "uint256", "name": "curatorTokenId", "type": "uint256" },
      { "internalType": "uint256", "name": "rapporteurTokenId", "type": "uint256" }
    ],
    "name": "publish",
    "outputs": [],
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
    "inputs": [],
    "name": "sessionCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "nextCreationAt", "type": "uint256" },
      { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
      { "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "name": "setSchedule",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "works",
    "outputs": [
      { "internalType": "uint256", "name": "id", "type": "uint256" },
      { "internalType": "string", "name": "content", "type": "string" },
      { "internalType": "uint256", "name": "authorTokenId", "type": "uint256" },
      { "internalType": "uint256", "name": "curatorTokenId", "type": "uint256" },
      { "internalType": "uint256", "name": "rapporteurTokenId", "type": "uint256" },
      { "internalType": "uint256", "name": "publishedAt", "type": "uint256" },
      { "internalType": "bool", "name": "archived", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
