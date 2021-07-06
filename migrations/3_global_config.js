const GlobalConfig = artifacts.require('global/GlobalConfig.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(GlobalConfig, { gas: 100000000 });
};
