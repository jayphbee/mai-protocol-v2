const ShareToken = artifacts.require('token/ShareToken.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(ShareToken, "Mai2 ShareToken", "STK", 18, { gas: 100000000 });
};
