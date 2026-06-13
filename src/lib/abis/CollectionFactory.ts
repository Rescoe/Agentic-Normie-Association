export const CollectionFactoryAbi = [
  {
    inputs: [
      { internalType: "uint256", name: "normieTokenId", type: "uint256" },
      { internalType: "string",  name: "name",          type: "string"  },
      { internalType: "string",  name: "symbol",        type: "string"  },
    ],
    name:            "createCollection",
    outputs:         [{ internalType: "address", name: "collection", type: "address" }],
    stateMutability: "nonpayable",
    type:            "function",
  },
  {
    inputs:          [{ internalType: "uint256", name: "normieTokenId", type: "uint256" }],
    name:            "getCollectionsOf",
    outputs:         [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type:            "function",
  },
  {
    inputs:          [],
    name:            "getAllCollections",
    outputs:         [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type:            "function",
  },
  {
    inputs:          [],
    name:            "getCollectionCount",
    outputs:         [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type:            "function",
  },
  {
    anonymous: false,
    inputs:    [
      { indexed: true,  internalType: "uint256", name: "normieTokenId", type: "uint256" },
      { indexed: true,  internalType: "address", name: "collection",    type: "address" },
      { indexed: false, internalType: "string",  name: "name",          type: "string"  },
      { indexed: false, internalType: "string",  name: "symbol",        type: "string"  },
      { indexed: false, internalType: "address", name: "minter",        type: "address" },
      { indexed: false, internalType: "uint256", name: "timestamp",     type: "uint256" },
    ],
    name: "CollectionCreated",
    type: "event",
  },
] as const;
