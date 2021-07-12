var PrivateKeyProvider = require('truffle-privatekey-provider');
const HDWalletProvider = require("@truffle/hdwallet-provider");
const m = "faith soccer decorate outer food symbol ramp pink sight armed mask clean"

module.exports = {
    migrations_directory: "migrations",
    networks: {
        development: {
            host: '127.0.0.1',
            port: 8545,
            network_id: '*',
            gas: 80000000,
            gasPrice: 10000000000,
        },
        production: {
            provider: () => new PrivateKeyProvider(process.env.PK, 'https://mainnet.infura.io'),
            network_id: 1,
            gasPrice: 26000000000,
            gas: 8000000,
            confirmations: 2
        },
        localchain: {
            provider: () => new HDWalletProvider(m, 'http://103.96.148.28:28545'),
            network_id: '2021',
            gasPrice: 10000000000,
        },
        ropsten: {
            provider: () => new PrivateKeyProvider(process.env.PK, 'https://ropsten.infura.io'),
            network_id: 3,
            gasPrice: 10000000000
        },
        rinkeby: {
            provider: () => new PrivateKeyProvider(process.env.PK, 'https://rinkeby.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161'),
            network_id: 4,
            gasPrice: 10000000000
        },
        arbrinkeby: {
            provider: () => new PrivateKeyProvider(process.env.PK, 'https://rinkeby.arbitrum.io/rpc'),
            network_id: '421611',
            gasPrice: 10000000000,
        },
        soliditycoverage: {
            host: 'localhost',
            network_id: '*',
            port: 8555,
            gas: 0xfffffffffff,
            gasPrice: 0x01
        }
    },
    compilers: {
        solc: {
            version: "0.5.15",
            evmVersion: "istanbul",
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                }
            },
        },
    },
    mocha: {
        enableTimeouts: false
    },
    plugins: ["solidity-coverage"]
};


