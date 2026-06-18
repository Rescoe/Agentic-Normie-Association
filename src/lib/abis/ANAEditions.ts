export const ANAEditionsAbi = [
  {
    "inputs": [
      { "internalType": "string",  "name": "name_",           "type": "string"  },
      { "internalType": "string",  "name": "symbol_",         "type": "string"  },
      { "internalType": "uint256", "name": "normieTokenId",   "type": "uint256" },
      { "internalType": "address", "name": "minter_",         "type": "address" },
      { "internalType": "address", "name": "authorAddr_",     "type": "address" },
      { "internalType": "address", "name": "curatorAddr_",    "type": "address" },
      { "internalType": "address", "name": "rapporteurAddr_", "type": "address" },
      { "internalType": "address", "name": "associationAddr_","type": "address" },
      { "internalType": "uint8",   "name": "authorPct_",      "type": "uint8"   },
      { "internalType": "uint8",   "name": "curatorPct_",     "type": "uint8"   },
      { "internalType": "uint8",   "name": "rapporteurPct_",  "type": "uint8"   }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [],                                                                                                                                                    "name": "CannotBuyOwn",      "type": "error" },
  { "inputs": [],                                                                                                                                                    "name": "NotTokenOwner",     "type": "error" },
  { "inputs": [],                                                                                                                                                    "name": "OnlyMinter",        "type": "error" },
  { "inputs": [],                                                                                                                                                    "name": "PctOverflow",       "type": "error" },
  { "inputs": [],                                                                                                                                                    "name": "ZeroAddress",       "type": "error" },
  { "inputs": [{ "internalType": "uint256", "name": "required", "type": "uint256" }, { "internalType": "uint256", "name": "sent", "type": "uint256" }],             "name": "InsufficientPayment", "type": "error" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId",  "type": "uint256" }],                                                                              "name": "TokenDoesNotExist",  "type": "error" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId",  "type": "uint256" }],                                                                              "name": "TokenNotForSale",    "type": "error" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "uint256", "name": "tokenId",  "type": "uint256" },
      { "indexed": true,  "internalType": "uint256", "name": "groupId",  "type": "uint256" },
      { "indexed": false, "internalType": "string",  "name": "title",    "type": "string"  },
      { "indexed": false, "internalType": "uint256", "name": "priceWei", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "total",    "type": "uint256" }
    ],
    "name": "EditionMinted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "uint256", "name": "tokenId",  "type": "uint256" },
      { "indexed": true,  "internalType": "address", "name": "buyer",    "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "priceWei", "type": "uint256" }
    ],
    "name": "EditionSold",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "uint256", "name": "tokenId",  "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "priceWei", "type": "uint256" }
    ],
    "name": "EditionListedForResale",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "EditionRemovedFromSale",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{ "indexed": true, "internalType": "address", "name": "newMinter", "type": "address" }],
    "name": "MinterUpdated",
    "type": "event"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "buyEdition",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "totalEditions", "type": "uint256" },
      { "internalType": "string",  "name": "content",       "type": "string"  },
      { "internalType": "string",  "name": "title",         "type": "string"  },
      { "internalType": "uint256", "name": "priceWei",      "type": "uint256" },
      { "internalType": "uint256", "name": "workId",        "type": "uint256" }
    ],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "tokenId",  "type": "uint256" },
      { "internalType": "uint256", "name": "priceWei", "type": "uint256" }
    ],
    "name": "listForResale",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "removeFromSale",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "getEdition",
    "outputs": [
      {
        "components": [
          { "internalType": "string",  "name": "content",      "type": "string"  },
          { "internalType": "string",  "name": "title",        "type": "string"  },
          { "internalType": "uint256", "name": "priceWei",     "type": "uint256" },
          { "internalType": "uint256", "name": "workId",       "type": "uint256" },
          { "internalType": "uint256", "name": "editionGroup", "type": "uint256" },
          { "internalType": "uint256", "name": "createdAt",    "type": "uint256" }
        ],
        "internalType": "struct ANAEditions.Edition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getForSaleTokens",
    "outputs": [{ "internalType": "uint256[]", "name": "", "type": "uint256[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextTokenId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "tokenForSale",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minter",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "authorAddr",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "curatorAddr",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rapporteurAddr",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
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
    "name": "authorPct",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "curatorPct",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "rapporteurPct",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "creatorNormieTokenId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "editionGroupSize",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "tokenId",   "type": "uint256" },
      { "internalType": "uint256", "name": "salePrice", "type": "uint256" }
    ],
    "name": "royaltyInfo",
    "outputs": [
      { "internalType": "address", "name": "receiver", "type": "address" },
      { "internalType": "uint256", "name": "amount",   "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "tokenURI",
    "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
    "name": "ownerOf",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newMinter", "type": "address" }],
    "name": "setMinter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "addr", "type": "address" }],
    "name": "setAuthorAddr",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "addr", "type": "address" }],
    "name": "setCuratorAddr",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "addr", "type": "address" }],
    "name": "setRapporteurAddr",
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
    "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }],
    "name": "transferOwnership",
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
  }
] as const;
