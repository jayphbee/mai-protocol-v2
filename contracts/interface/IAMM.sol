pragma solidity 0.5.15;
pragma experimental ABIEncoderV2; // to enable structure-type parameter

import "../lib/LibTypes.sol";
import "../interface/IPerpetual.sol";


interface IAMM {
    function shareTokenAddress() external view returns (address);

    function indexPrice() external view returns (uint256 price, uint256 timestamp);

    function positionSize() external returns (uint256);

    function lastFundingState() external view returns (LibTypes.FundingState memory);

    function currentFundingRate() external returns (int256);

    function currentFundingState() external returns (LibTypes.FundingState memory);

    function lastFundingRate() external view returns (int256);

    function getGovernance() external view returns (LibTypes.AMMGovernanceConfig memory);

    function perpetualProxy() external view returns (IPerpetual);

    function currentMarkPrice() external returns (uint256);

    function currentAvailableMargin() external returns (uint256);

    function currentPremiumRate() external returns (int256);

    function currentFairPrice() external returns (uint256);

    function currentPremium() external returns (int256);

    function currentAccumulatedFundingPerContract() external returns (int256);

    function updateIndex() external;

    function createPool(uint256 amount) external;

    function settleShare(uint256 shareAmount) external;

    function buy(uint256 amount, uint256 limitPrice, uint256 deadline) external returns (uint256);

    function sell(uint256 amount, uint256 limitPrice, uint256 deadline) external returns (uint256);

    function buyFromWhitelisted(address trader, uint256 amount, uint256 limitPrice, uint256 deadline)
        external
        returns (uint256);

    function sellFromWhitelisted(address trader, uint256 amount, uint256 limitPrice, uint256 deadline)
        external
        returns (uint256);

    function buyFrom(address trader, uint256 amount, uint256 limitPrice, uint256 deadline) external returns (uint256);

    function sellFrom(address trader, uint256 amount, uint256 limitPrice, uint256 deadline) external returns (uint256);

    function depositAndBuy(
        uint256 depositAmount,
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline
    ) external payable;

    function depositAndSell(
        uint256 depositAmount,
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline
    ) external payable;

    function buyAndWithdraw(
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline,
        uint256 withdrawAmount
    ) external;

    function sellAndWithdraw(
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline,
        uint256 withdrawAmount
    ) external;

    function depositAndAddLiquidity(uint256 depositAmount, uint256 amount) external payable;

    function setFairPrice(uint256 price) external;
}
