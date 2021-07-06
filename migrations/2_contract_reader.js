
const ContractReader = artifacts.require('reader/ContractReader.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(ContractReader, { gas: 100000000 });
};
