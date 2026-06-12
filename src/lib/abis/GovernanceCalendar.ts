export const GovernanceCalendarAbi = [
  { "inputs": [], "stateMutability": "nonpayable", "type": "constructor" },
  { "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }], "name": "EventAlreadyCancelled", "type": "error" },
  { "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }], "name": "EventNotFound", "type": "error" },
  { "inputs": [{ "internalType": "uint256", "name": "scheduledAt", "type": "uint256" }, { "internalType": "uint256", "name": "current", "type": "uint256" }], "name": "EventNotDueYet", "type": "error" },
  { "inputs": [], "name": "FoundingScheduleAlreadyInitialized", "type": "error" },
  { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }], "name": "OwnableInvalidOwner", "type": "error" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "OwnableUnauthorizedAccount", "type": "error" },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "eventId", "type": "uint256" }],
    "name": "EventCancelled", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "eventId", "type": "uint256" },
      { "indexed": true, "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
      { "indexed": false, "internalType": "uint256", "name": "scheduledAt", "type": "uint256" },
      { "indexed": false, "internalType": "bool", "name": "recurring", "type": "bool" },
      { "indexed": false, "internalType": "uint256", "name": "periodSeconds", "type": "uint256" }
    ],
    "name": "EventScheduled", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "eventId", "type": "uint256" },
      { "indexed": true, "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "triggeredBy", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
    ],
    "name": "EventTriggered", "type": "event"
  },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferred", "type": "event" },
  {
    "inputs": [],
    "name": "BURN_CREATION", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "ELECTION", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "GENERAL_ASSEMBLY", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "INSCRIPTION_CLOSE", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "INSCRIPTION_OPEN", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "WORK_SESSION", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  {
    "inputs": [{ "internalType": "uint256", "name": "eventId", "type": "uint256" }],
    "name": "cancelEvent", "outputs": [], "stateMutability": "nonpayable", "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "events",
    "outputs": [
      { "internalType": "uint256", "name": "id", "type": "uint256" },
      { "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
      { "internalType": "string",  "name": "description", "type": "string" },
      { "internalType": "uint256", "name": "scheduledAt", "type": "uint256" },
      { "internalType": "uint256", "name": "durationSeconds", "type": "uint256" },
      { "internalType": "bool",    "name": "executed", "type": "bool" },
      { "internalType": "bool",    "name": "recurring", "type": "bool" },
      { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
      { "internalType": "bool",    "name": "cancelled", "type": "bool" }
    ],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [],
    "name": "foundingScheduleInitialized",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [],
    "name": "getDueEvents",
    "outputs": [{
      "components": [
        { "internalType": "uint256", "name": "id", "type": "uint256" },
        { "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
        { "internalType": "string",  "name": "description", "type": "string" },
        { "internalType": "uint256", "name": "scheduledAt", "type": "uint256" },
        { "internalType": "uint256", "name": "durationSeconds", "type": "uint256" },
        { "internalType": "bool",    "name": "executed", "type": "bool" },
        { "internalType": "bool",    "name": "recurring", "type": "bool" },
        { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
        { "internalType": "bool",    "name": "cancelled", "type": "bool" }
      ],
      "internalType": "struct GovernanceCalendar.CalendarEvent[]",
      "name": "", "type": "tuple[]"
    }],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "id", "type": "uint256" }],
    "name": "getEvent",
    "outputs": [{
      "components": [
        { "internalType": "uint256", "name": "id", "type": "uint256" },
        { "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
        { "internalType": "string",  "name": "description", "type": "string" },
        { "internalType": "uint256", "name": "scheduledAt", "type": "uint256" },
        { "internalType": "uint256", "name": "durationSeconds", "type": "uint256" },
        { "internalType": "bool",    "name": "executed", "type": "bool" },
        { "internalType": "bool",    "name": "recurring", "type": "bool" },
        { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
        { "internalType": "bool",    "name": "cancelled", "type": "bool" }
      ],
      "internalType": "struct GovernanceCalendar.CalendarEvent",
      "name": "", "type": "tuple"
    }],
    "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "getEventCount", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  {
    "inputs": [],
    "name": "getUpcomingEvents",
    "outputs": [{
      "components": [
        { "internalType": "uint256", "name": "id", "type": "uint256" },
        { "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
        { "internalType": "string",  "name": "description", "type": "string" },
        { "internalType": "uint256", "name": "scheduledAt", "type": "uint256" },
        { "internalType": "uint256", "name": "durationSeconds", "type": "uint256" },
        { "internalType": "bool",    "name": "executed", "type": "bool" },
        { "internalType": "bool",    "name": "recurring", "type": "bool" },
        { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" },
        { "internalType": "bool",    "name": "cancelled", "type": "bool" }
      ],
      "internalType": "struct GovernanceCalendar.CalendarEvent[]",
      "name": "", "type": "tuple[]"
    }],
    "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "initializeFoundingSchedule", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "renounceOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "eventType", "type": "bytes32" },
      { "internalType": "string",  "name": "description", "type": "string" },
      { "internalType": "uint256", "name": "scheduledAt", "type": "uint256" },
      { "internalType": "uint256", "name": "durationSeconds", "type": "uint256" },
      { "internalType": "bool",    "name": "recurring", "type": "bool" },
      { "internalType": "uint256", "name": "periodSeconds", "type": "uint256" }
    ],
    "name": "scheduleEvent",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "nonpayable", "type": "function"
  },
  { "inputs": [{ "internalType": "uint256", "name": "eventId", "type": "uint256" }], "name": "triggerEvent", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }], "name": "transferOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
] as const;
