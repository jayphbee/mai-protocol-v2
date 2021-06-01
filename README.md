# MAI PROTOCOL V2 - PERPETUAL CONTRACT

[![Build Status](https://travis-ci.org/mcdexio/mai-protocol-v2.svg?branch=master)](https://travis-ci.org/mcdexio/mai-protocol-v2)
[![Coverage Status](https://coveralls.io/repos/github/mcdexio/mai-protocol-v2/badge.svg?branch=master)](https://coveralls.io/github/mcdexio/mai-protocol-v2?branch=master)

Mai Protocol V2 builds the decentralized Perpetual contracts on Ethereum.

The name Mai comes from two Chinese characters "买" which means buy and "卖" which means sell. Using pinyin (the modern system for transliterating Chinese characters to Latin letters) "买" is spelled Mǎi and "卖" is spelled Mài. Thus, "Mai" means "Buy" and "Sell".

## Key Features

- Isolated margin account management
- Trade & manage the position
- AMM to provide on-chain liquidity & funding rate
- Funding payment between long/short positions
- Validate the users' orders and execute the match result of order book
- Liquidation of the unsafe position
- Insurance fund
- Socialize the liquidation loss
- Global settlement when an emergency to keep the users' assets safe

## Design Details

Check our [MCDEX Documents](https://github.com/mcdexio/documents) to get more information.

## Deployed Contracts

### Generic

|Contract|Description|Address|
|---|---|---|
|[`GlobalConfig`](contracts/global/GlobalConfig.sol)   |Common governance parameters                            |[0x71e77Ffbbfd4418ED47981927738b5425c187F64](https://etherscan.io/address/0x71e77Ffbbfd4418ED47981927738b5425c187F64)|
|[`Exchange`](contracts/exchange/Exchange.sol)       |Order book exchange logic                                |[0xbF5c98A4eD00C28957b6e15A01102DC2568D2650](https://etherscan.io/address/0xbF5c98A4eD00C28957b6e15A01102DC2568D2650)|
|[`ContractReader`](contracts/reader/ContractReader.sol) |A batch reader in order to reduce calling consumption   |[0x53C9Df248150AD849bD1BadD3C83b0f6cb735052](https://etherscan.io/address/0x53C9Df248150AD849bD1BadD3C83b0f6cb735052)|

### ETH-PERP

|Contract|Description|Address|
|---|---|---|
|[`Perpetual`](contracts/perpetual/Perpetual.sol)      |Perpetual core logic including margin account, PnL, etc.|[0x220a9f0DD581cbc58fcFb907De0454cBF3777f76](https://etherscan.io/address/0x220a9f0DD581cbc58fcFb907De0454cBF3777f76)|
|[`AMM`](contracts/liquidity/AMM.sol)            |Automated Market Maker                                  |[0xAAaC8434217575643B2D2aB6f12CE8600C625520](https://etherscan.io/address/0xAAaC8434217575643B2D2aB6f12CE8600C625520)|
|[`Proxy`](contracts/proxy/PerpetualProxy.sol)          |AMM margin account                                      |[0x05c363D2B9AFc36b070fe2c61711280eDC214678](https://etherscan.io/address/0x05c363D2B9AFc36b070fe2c61711280eDC214678)|
|[`PriceFeeder`](contracts/oracle/InversedChainlinkAdapter.sol)    |Price oracle                                            |[0xcfa46E1b666fd91Bf39028055D506c1e4cA5aD6E](https://etherscan.io/address/0x9B2D7D7f7b2810Ef2be979fc2ACebe6097d9563A)|
|[`ShareToken`](contracts/token/ShareToken.sol)     |Share token of the AMM                                  |[0xAe694FB9DCD1E6195519c0056B2aB19380B26FF2](https://etherscan.io/address/0xAe694FB9DCD1E6195519c0056B2aB19380B26FF2)|

### LINK-PERP

|Contract|Description|Address|
|---|---|---|
|Perpetual      |Perpetual core logic including margin account, PnL, etc.|[0xa04197e5f7971e7aef78cf5ad2bc65aac1a967aa](https://etherscan.io/address/0x220a9f0DD581cbc58fcFb907De0454cBF3777f76)|
|AMM            |Automated Market Maker                                  |[0x7230d622d067d9c30154a750dbd29c035ba7605a](https://etherscan.io/address/0xAAaC8434217575643B2D2aB6f12CE8600C625520)|
|Proxy          |AMM margin account                                      |[0x694baa24d46530e46bcd39b1f07943a2bddb01e6](https://etherscan.io/address/0x05c363D2B9AFc36b070fe2c61711280eDC214678)|
|PriceFeeder    |Price oracle                                            |[0x8597eb9e005f39f8f70a17aea914b20450abfe60](https://etherscan.io/address/0x9B2D7D7f7b2810Ef2be979fc2ACebe6097d9563A)|
|ShareToken     |Share token of the AMM                                  |[0xd78ba1d99dbbc4eba3b206c9c67a08879b6ec79b](https://etherscan.io/address/0xAe694FB9DCD1E6195519c0056B2aB19380B26FF2)|

### COMP-PERP

|Contract|Description|Address|
|---|---|---|
|Perpetual      |Perpetual core logic including margin account, PnL, etc.|[0xfa203e643D1FDDC5d8B91253eA23B3bD826cae9e](https://etherscan.io/address/0xfa203e643D1FDDC5d8B91253eA23B3bD826cae9e)|
|AMM            |Automated Market Maker                                  |[0x5378B0388Ef594f0c2EB194504aee2B48d1eac18](https://etherscan.io/address/0x5378B0388Ef594f0c2EB194504aee2B48d1eac18)|
|Proxy          |AMM margin account                                      |[0x69F3EbB9f14F7048E675443Fb6375F9D48D8a9d6](https://etherscan.io/address/0x69F3EbB9f14F7048E675443Fb6375F9D48D8a9d6)|
|PriceFeeder    |Price oracle                                            |[0x78963E7cB9454cCf8412Cd0B5bC4C69AD5cDbBd3](https://etherscan.io/address/0x78963E7cB9454cCf8412Cd0B5bC4C69AD5cDbBd3)|
|ShareToken     |Share token of the AMM                                  |[0x9ec63850650BC7aEC297BA023f0C1650CBbd6958](https://etherscan.io/address/0x9ec63850650BC7aEC297BA023f0C1650CBbd6958)|

### LEND-PERP

|Contract|Description|Address|
|---|---|---|
|Perpetual      |Perpetual core logic including margin account, PnL, etc.|[0xd48C88A18BFA81486862c6d1d172a39F1365e8AC](https://etherscan.io/address/0xd48C88A18BFA81486862c6d1d172a39F1365e8AC)|
|AMM            |Automated Market Maker                                  |[0xBe83943d5CA2d66Fb7ba3A8d4A983782f31a42dc](https://etherscan.io/address/0xBe83943d5CA2d66Fb7ba3A8d4A983782f31a42dc)|
|Proxy          |AMM margin account                                      |[0xD8642327B919295FE2733a73DE1D2355b589cb04](https://etherscan.io/address/0xD8642327B919295FE2733a73DE1D2355b589cb04)|
|PriceFeeder    |Price oracle                                            |[0x784819cbA91Ed87C296565274fc150EaA11EBC04](https://etherscan.io/address/0x784819cbA91Ed87C296565274fc150EaA11EBC04)|
|ShareToken     |Share token of the AMM                                  |[0x3d4b40ca0f98fcce38aa1704cbdf134496c261e8](https://etherscan.io/address/0x3d4b40ca0f98fcce38aa1704cbdf134496c261e8)|

### SNX-PERP

|Contract|Description|Address|
|---|---|---|
|Perpetual      |Perpetual core logic including margin account, PnL, etc.|[0x4cC89906db523Af7C3bB240a959bE21Cb812b434](https://etherscan.io/address/0x4cC89906db523Af7C3bB240a959bE21Cb812b434)|
|AMM            |Automated Market Maker                                  |[0x942Df696cd1995ba2eAB710D168B2D9CeE53B52c](https://etherscan.io/address/0x942Df696cd1995ba2eAB710D168B2D9CeE53B52c)|
|Proxy          |AMM margin account                                      |[0x298BadDa419EECE0abe86FeDC2f0677a7e8E35a2](https://etherscan.io/address/0x298BadDa419EECE0abe86FeDC2f0677a7e8E35a2)|
|PriceFeeder    |Price oracle                                            |[0xA2fe15e40f5cCc480b545eb8FFAbdCDB84a3D3Dc](https://etherscan.io/address/0xA2fe15e40f5cCc480b545eb8FFAbdCDB84a3D3Dc)|
|ShareToken     |Share token of the AMM                                  |[0xf377810BFFc83DF177d7f992A8807943EA0a286F](https://etherscan.io/address/0xf377810BFFc83DF177d7f992A8807943EA0a286F)|

