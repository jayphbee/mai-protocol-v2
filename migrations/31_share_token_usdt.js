const ShareToken = artifacts.require('token/ShareToken.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(ShareToken, "ShareToken", "STK", 18, { gas: 200000000 });
};
