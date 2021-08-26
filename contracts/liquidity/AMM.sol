pragma solidity 0.5.15;
pragma experimental ABIEncoderV2; // to enable structure-type parameters

import {LibMathSigned, LibMathUnsigned} from "../lib/LibMath.sol";

import "../lib/LibTypes.sol";
import "../interface/IPriceFeeder.sol";
import "../interface/IPerpetual.sol";
import "../token/ShareToken.sol";
import "./AMMGovernance.sol";


contract AMM is AMMGovernance {
    using LibMathSigned for int256;
    using LibMathUnsigned for uint256;

    int256 private constant FUNDING_PERIOD = 28800; // 8 * 3600;
    uint256 private _fairPrice;

    // ERC20 token
    ShareToken private shareToken;

    event CreateAMM();
    event UpdateFundingRate(LibTypes.FundingState fundingState);

    constructor(
        address _globalConfig,
        address _perpetualProxy,
        address _priceFeeder,
        address _shareToken
    )
        public
        AMMGovernance(_globalConfig)
    {
        priceFeeder = IPriceFeeder(_priceFeeder);
        perpetualProxy = IPerpetual(_perpetualProxy);
        shareToken = ShareToken(_shareToken);

        emit CreateAMM();
    }

    /**
     * @notice Share token's ERC20 address.
     */
    function shareTokenAddress() public view returns (address) {
        return address(shareToken);
    }

    /**
     * @notice Index price.
     *
     * Re-read the oracle price instead of the cached value.
     */
    function indexPrice() public view returns (uint256 price, uint256 timestamp) {
        (price, timestamp) = priceFeeder.price();
        require(price != 0, "dangerous index price");
    }

    /**
     * @notice Pool's position size (y).
     */
    function positionSize() public view returns (uint256) {
        return perpetualProxy.getMarginAccount(tradingAccount()).size;
    }

    /**
     * @notice FundingState.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastFundingState() public view returns (LibTypes.FundingState memory) {
        return fundingState;
    }

    /**
     * @notice AvailableMargin (x).
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastAvailableMargin() internal view returns (uint256) {
        LibTypes.MarginAccount memory account = perpetualProxy.getMarginAccount(tradingAccount());
        return availableMarginFromPoolAccount(account);
    }

    /**
     * @notice FairPrice.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastFairPrice() internal view returns (uint256) {
        return fairPriceFromPoolAccount();
    }

    /**
     * @notice Premium.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastPremium() internal view returns (int256) {
        return premiumFromPoolAccount();
    }

    /**
     * @notice EMAPremium.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastEMAPremium() internal view returns (int256) {
        return fundingState.lastEMAPremium;
    }

    /**
     * @notice MarkPrice.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastMarkPrice() internal view returns (uint256) {
        int256 index = fundingState.lastIndexPrice.toInt256();
        int256 limit = index.wmul(governance.markPremiumLimit);
        int256 p = index.add(lastEMAPremium());
        p = p.min(index.add(limit));
        p = p.max(index.sub(limit));
        return p.max(0).toUint256();
    }

    /**
     * @notice PremiumRate.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastPremiumRate() internal view returns (int256) {
        int256 index = fundingState.lastIndexPrice.toInt256();
        int256 rate = lastMarkPrice().toInt256();
        rate = rate.sub(index).wdiv(index);
        return rate;
    }

    /**
     * @notice FundingRate.
     *
     * Note: last* functions (lastFundingState, lastAvailableMargin, lastFairPrice, etc.) are calculated based on
     *       the on-chain fundingState. current* functions are calculated based on the current timestamp.
     */
    function lastFundingRate() public view returns (int256) {
        int256 rate = lastPremiumRate();
        return rate.max(governance.fundingDampener).add(rate.min(-governance.fundingDampener));
    }

    // Public functions

    /**
     * @notice FundingState.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentFundingState() public returns (LibTypes.FundingState memory) {
        funding();
        return fundingState;
    }

    /**
     * @notice AvailableMargin (x).
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentAvailableMargin() public returns (uint256) {
        funding();
        return lastAvailableMargin();
    }

    /**
     * @notice FairPrice.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentFairPrice() public returns (uint256) {
        funding();
        return lastFairPrice();
    }

    /**
     * @notice Premium.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentPremium() public returns (int256) {
        funding();
        return lastPremium();
    }

    /**
     * @notice MarkPrice.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentMarkPrice() public returns (uint256) {
        funding();
        return lastMarkPrice();
    }

    /**
     * @notice PremiumRate.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentPremiumRate() public returns (int256) {
        funding();
        return lastPremiumRate();
    }

    /**
     * @notice FundingRate.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentFundingRate() public returns (int256) {
        funding();
        return lastFundingRate();
    }

    /**
     * @notice AccumulatedFundingPerContract.
     *
     * Note: current* functions (currentFundingState, currentAvailableMargin, currentFairPrice, etc.) are calculated based on
     *       the current timestamp. current* functions are calculated based on the on-chain fundingState.
     */
    function currentAccumulatedFundingPerContract() public returns (int256) {
        funding();
        return fundingState.accumulatedFundingPerContract;
    }

    /**
     * @notice The pool's margin account.
     */
    function tradingAccount() internal view returns (address) {
        return address(perpetualProxy);
    }

    /**
     * @notice The 1st addLiquidity.
     *
     * The semantics of this function is almost identical to addLiquidity except that the trading price
     * is not determined by fairPrice, but by indexPrice.
     *
     * Note: buy() and sell() will fail before this function is called.
     * @param amount Sell amount. Must be a multiple of lotSize.
     */
    function createPool(uint256 amount) public {
        require(amount > 0, "amount must be greater than zero");
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");
        require(positionSize() == 0, "pool not empty");

        address trader = msg.sender;
        uint256 blockTime = getBlockTimestamp();
        uint256 newIndexPrice;
        uint256 newIndexTimestamp;
        (newIndexPrice, newIndexTimestamp) = indexPrice();

        initFunding(newIndexPrice, blockTime);
        perpetualProxy.transferCashBalance(trader, tradingAccount(), newIndexPrice.wmul(amount).mul(2));
        (uint256 opened, ) = perpetualProxy.tradePosition(
            trader,
            tradingAccount(),
            LibTypes.Side.SHORT,
            newIndexPrice,
            amount
        );
        mintShareTokenTo(trader, amount);

        forceFunding(); // x, y changed, so fair price changed. we need funding now
        mustSafe(trader, opened);
    }

    /**
     * @notice Price of buy/long.
     *
     * @param amount Buy amount.
     */
    function getBuyPrice(uint256 amount) internal returns (uint256 price) {
        uint256 x;
        uint256 y;
        (x, y) = currentXY();
        require(y != 0 && x != 0, "empty pool");
        return x.wdiv(y.sub(amount));
    }

    /**
     * @notice Real implementation of buy/long.
     *
     * @param trader The trader.
     * @param amount Buy amount. Must be a multiple of lotSize.
     * @param limitPrice Assert the trading price <= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function buyFrom(
        address trader,
        uint256 amount,
        uint256 limitPrice,
        uint256 deadline
    )
        private
        returns (uint256) {
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");
        require(perpetualProxy.isValidTradingLotSize(amount), "amount must be divisible by tradingLotSize");

        uint256 price = getBuyPrice(amount);
        require(limitPrice >= price, "price limited");
        require(getBlockTimestamp() <= deadline, "deadline exceeded");
        (uint256 opened, ) = perpetualProxy.tradePosition(trader, tradingAccount(), LibTypes.Side.LONG, price, amount);

        uint256 value = price.wmul(amount);
        uint256 fee = value.wmul(governance.poolFeeRate);
        uint256 devFee = value.wmul(governance.poolDevFeeRate);
        address devAddress = perpetualProxy.devAddress();

        perpetualProxy.transferCashBalance(trader, tradingAccount(), fee);
        perpetualProxy.transferCashBalance(trader, devAddress, devFee);

        forceFunding(); // x, y changed, so fair price changed. we need funding now
        mustSafe(trader, opened);
        return opened;
    }

    /**
     * @notice Buy/long with AMM if the trader comes from the whitelist.
     *
     * @param trader The trader.
     * @param amount Buy amount. Must be a multiple of lotSize.
     * @param limitPrice Assert the trading price <= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function buyFromWhitelisted(
        address trader,
        uint256 amount,
        uint256 limitPrice,
        uint256 deadline
    )
        public
        onlyAuthorized
        returns (uint256)
    {
        return buyFrom(trader, amount, limitPrice, deadline);
    }

    /**
     * @notice Buy/long with AMM.
     *
     * @param amount Buy amount. Must be a multiple of lotSize.
     * @param limitPrice Assert the trading price <= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function buy(
        uint256 amount,
        uint256 limitPrice,
        uint256 deadline
    ) public returns (uint256) {
        return buyFrom(msg.sender, amount, limitPrice, deadline);
    }

    /**
     * @notice Price of sell/short.
     *
     * @param amount Sell amount.
     */
    function getSellPrice(uint256 amount) internal returns (uint256 price) {
        uint256 x;
        uint256 y;
        (x, y) = currentXY();
        require(y != 0 && x != 0, "empty pool");
        return x.wdiv(y.add(amount));
    }

    /**
     * @notice Real implementation of sell/short.
     *
     * @param trader The trader.
     * @param amount Sell amount. Must be a multiple of lotSize.
     * @param limitPrice Assert the trading price >= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function sellFrom(
        address trader,
        uint256 amount,
        uint256 limitPrice,
        uint256 deadline
    ) private returns (uint256) {
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");
        require(perpetualProxy.isValidTradingLotSize(amount), "amount must be divisible by tradingLotSize");

        uint256 price = getSellPrice(amount);
        require(limitPrice <= price, "price limited");
        require(getBlockTimestamp() <= deadline, "deadline exceeded");
        (uint256 opened, ) = perpetualProxy.tradePosition(trader, tradingAccount(), LibTypes.Side.SHORT, price, amount);

        uint256 value = price.wmul(amount);
        uint256 fee = value.wmul(governance.poolFeeRate);
        uint256 devFee = value.wmul(governance.poolDevFeeRate);
        address devAddress = perpetualProxy.devAddress();
        perpetualProxy.transferCashBalance(trader, tradingAccount(), fee);
        perpetualProxy.transferCashBalance(trader, devAddress, devFee);

        forceFunding(); // x, y changed, so fair price changed. we need funding now
        mustSafe(trader, opened);
        return opened;
    }

    /**
     * @notice Sell/short with AMM if the trader comes from the whitelist.
     *
     * @param trader The trader.
     * @param amount Sell amount. Must be a multiple of lotSize.
     * @param limitPrice Assert the trading price >= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function sellFromWhitelisted(
        address trader,
        uint256 amount,
        uint256 limitPrice,
        uint256 deadline
    )
        public
        onlyAuthorized
        returns (uint256)
    {
        return sellFrom(trader, amount, limitPrice, deadline);
    }

    /**
     * @notice Sell/short with AMM.
     *
     * @param amount Sell amount. Must be a multiple of lotSize.
     * @param limitPrice Assert the trading price >= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function sell(
        uint256 amount,
        uint256 limitPrice,
        uint256 deadline
    ) public returns (uint256) {
        return sellFrom(msg.sender, amount, limitPrice, deadline);
    }

    /**
     * @notice Move collateral from the current liquidity provider's margin account into AMM and mint the Share token.
     *
     * After addLiquidity, the liquidity provider will:
     * 1. Pay (2 * amount * price) collateral.
     * 2. Get Share tokens to prove that there're some Long positions and collaterals in AMM that belongs to current liquidity provider.
     * 3. Get some Short positions.
     *
     * The number of short positions obtained is obviously the same as the number of long positions obtained in the pool.
     *
     * @param amount Sell amount. Must be a multiple of lotSize.
     */
    function addLiquidity(uint256 amount) public {
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");

        uint256 oldAvailableMargin;
        uint256 oldPoolPositionSize;
        (oldAvailableMargin, oldPoolPositionSize) = currentXY();
        require(oldPoolPositionSize != 0 && oldAvailableMargin != 0, "empty pool");

        address trader = msg.sender;
        uint256 price = oldAvailableMargin.wdiv(oldPoolPositionSize);

        uint256 collateralAmount = amount.wmul(price).mul(2);
        perpetualProxy.transferCashBalance(trader, tradingAccount(), collateralAmount);
        (uint256 opened, ) = perpetualProxy.tradePosition(trader, tradingAccount(), LibTypes.Side.SHORT, price, amount);

        mintShareTokenTo(trader, shareToken.totalSupply().wmul(amount).wdiv(oldPoolPositionSize));

        forceFunding(); // x, y changed, so fair price changed. we need funding now
        mustSafe(trader, opened);
    }

    /**
     * @notice Burn Share tokens to remove the collateral attributed to the current liquidity provider
     *         from AMM into the liquidity provider's margin account.
     *
     * @param shareAmount The number of share tokens about to burn. The real trading amount will be
     *        automatically aligned to lotSize.
     */
    function removeLiquidity(uint256 shareAmount) public {
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");

        address trader = msg.sender;
        uint256 oldAvailableMargin;
        uint256 oldPoolPositionSize;
        (oldAvailableMargin, oldPoolPositionSize) = currentXY();
        require(oldPoolPositionSize != 0 && oldAvailableMargin != 0, "empty pool");
        require(shareToken.balanceOf(msg.sender) >= shareAmount, "shareBalance too low");
        uint256 price = oldAvailableMargin.wdiv(oldPoolPositionSize);
        uint256 amount = shareAmount.wmul(oldPoolPositionSize).wdiv(shareToken.totalSupply());
        // align to lotSize
        uint256 lotSize = perpetualProxy.getGovernance().lotSize;
        amount = amount.sub(amount.mod(lotSize));

        perpetualProxy.transferCashBalance(tradingAccount(), trader, price.wmul(amount).mul(2));
        burnShareTokenFrom(trader, shareAmount);
        (uint256 opened, ) = perpetualProxy.tradePosition(trader, tradingAccount(), LibTypes.Side.LONG, price, amount);

        forceFunding(); // x, y changed, so fair price changed. we need funding now
        mustSafe(trader, opened);
    }

    /**
     * @notice In SETTLED status, burn Share tokens to remove the collateral attributed to the current liquidity provider
     *         from AMM to the liquidity provider's margin account.
     *
     * Also call perpetual.settle() to finally withdraw all collaterals after calling this function.
     */
    function settleShare() public {
        require(perpetualProxy.status() == LibTypes.Status.SETTLED, "wrong perpetual status");

        address trader = msg.sender;
        LibTypes.MarginAccount memory account = perpetualProxy.getMarginAccount(tradingAccount());
        uint256 total = availableMarginFromPoolAccount(account);
        uint256 shareAmount = shareToken.balanceOf(trader);
        uint256 balance = shareAmount.wmul(total).wdiv(shareToken.totalSupply());
        perpetualProxy.transferCashBalance(tradingAccount(), trader, balance);
        burnShareTokenFrom(trader, shareAmount);
    }

    /**
     * @notice This is a composite function of perp.deposit + amm.buy.
     *
     * Composite functions accept amount = 0.
     *
     * @param depositAmount The collateral amount. Note: The actual token.decimals should be filled in and not necessarily 18.
     * @param tradeAmount Buy amount.
     * @param limitPrice Assert the trading price <= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function depositAndBuy(
        uint256 depositAmount,
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline
    )
        public
        payable
    {
        if (depositAmount > 0) {
            perpetualProxy.depositFor.value(msg.value)(msg.sender, depositAmount);
        }
        if (tradeAmount > 0) {
            buy(tradeAmount, limitPrice, deadline);
        }
    }

    /**
     * @notice This is a composite function of perp.deposit + amm.sell.
     *
     * Composite functions accept amount = 0.
     *
     * @param depositAmount The collateral amount. Note: The actual token.decimals should be filled in and not necessarily 18.
     * @param tradeAmount Sell amount.
     * @param limitPrice Assert the trading price >= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     */
    function depositAndSell(
        uint256 depositAmount,
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline
    )
        public
        payable
    {
        if (depositAmount > 0) {
            perpetualProxy.depositFor.value(msg.value)(msg.sender, depositAmount);
        }
        if (tradeAmount > 0) {
            sell(tradeAmount, limitPrice, deadline);
        }
    }

    /**
     * @notice This is a composite function of amm.buy + perp.withdraw.
     *
     * Composite functions accept amount = 0.
     *
     * @param tradeAmount Buy amount.
     * @param limitPrice Assert the trading price <= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     * @param withdrawAmount The collateral amount. Note: The actual token.decimals should be filled in and not necessarily 18.
     */
    function buyAndWithdraw(
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline,
        uint256 withdrawAmount
    ) public {
        if (tradeAmount > 0) {
            buy(tradeAmount, limitPrice, deadline);
        }
        if (withdrawAmount > 0) {
            perpetualProxy.withdrawFor(msg.sender, withdrawAmount);
        }
    }

    /**
     * @notice This is a composite function of amm.sell + perp.withdraw.
     *
     * Composite functions accept amount = 0.
     *
     * @param tradeAmount Sell amount.
     * @param limitPrice Assert the trading price >= limitPrice.
     * @param deadline Assert the trading time <= deadline.
     * @param withdrawAmount The collateral amount. Note: The actual token.decimals should be filled in and not necessarily 18.
     */
    function sellAndWithdraw(
        uint256 tradeAmount,
        uint256 limitPrice,
        uint256 deadline,
        uint256 withdrawAmount
    ) public {
        if (tradeAmount > 0) {
            sell(tradeAmount, limitPrice, deadline);
        }
        if (withdrawAmount > 0) {
            perpetualProxy.withdrawFor(msg.sender, withdrawAmount);
        }
    }

    /**
     * @notice This is a composite function of perp.deposit + amm.addLiquidity.
     *
     * Composite functions accept amount = 0.
     *
     * After depositAndAddLiquidity, the liquidity provider will:
     * 1. Deposit depositAmount collateral.
     * 2. Pay (2 * amount * price) collateral.
     * 3. Get Share tokens to prove that there're some Long positions and collaterals in AMM that belongs to current liquidity provider.
     * 4. Get some Short positions.
     *
     * The number of short positions obtained is obviously the same as the number of long positions obtained in the pool.
     *
     * @param depositAmount The collateral amount. Note: The actual token.decimals should be filled in and not necessarily 18.
     * @param amount Sell amount, pay (2 * amount * price) collateral.
     */
    function depositAndAddLiquidity(uint256 depositAmount, uint256 amount) public payable {
        if (depositAmount > 0) {
            perpetualProxy.depositFor.value(msg.value)(msg.sender, depositAmount);
        }
        if (amount > 0) {
            addLiquidity(amount);
        }
    }

    /**
     * @notice Any ETH address can call this function to update the index price of this AMM and get some prize.
     */
    function updateIndex() public {
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");
        uint256 oldIndexPrice = fundingState.lastIndexPrice;
        forceFunding();
        address devAddress = perpetualProxy.devAddress();
        if (oldIndexPrice != fundingState.lastIndexPrice) {
            perpetualProxy.transferCashBalance(devAddress, msg.sender, governance.updatePremiumPrize);
            require(perpetualProxy.isSafe(devAddress), "dev unsafe");
        }
    }

    // Internal helpers

    /**
     * @notice In order to mock the block.timestamp
     */
    function getBlockTimestamp() internal view returns (uint256) {
        // solium-disable-next-line security/no-block-members
        return block.timestamp;
    }

    /**
     * @notice a gas-optimized version of currentAvailableMargin() + positionSize(). almost all formulas require these two
     */
    function currentXY() internal returns (uint256 x, uint256 y) {
        funding();
        LibTypes.MarginAccount memory account = perpetualProxy.getMarginAccount(tradingAccount());
        x = availableMarginFromPoolAccount(account);
        y = account.size;
    }

    /**
     * @notice a gas-optimized version of lastAvailableMargin()
     */
    function availableMarginFromPoolAccount(LibTypes.MarginAccount memory account) internal view returns (uint256) {
        int256 available = account.cashBalance;
        int256 socialLossPerContract = perpetualProxy.socialLossPerContract(account.side);
        available = available.sub(account.entryValue.toInt256());
        available = available.sub(socialLossPerContract.wmul(account.size.toInt256()).sub(account.entrySocialLoss));
        available = available.sub(
            fundingState.accumulatedFundingPerContract.wmul(account.size.toInt256()).sub(account.entryFundingLoss)
        );
        return available.max(0).toUint256();
    }

    /**
     * @notice a gas-optimized version of lastFairPrice
     */
    function fairPriceFromPoolAccount() internal view returns (uint256) {
        return _fairPrice;
    }

    function setFairPrice(uint256 price) external onlyAuthorized {
        _fairPrice = price;
        funding();
    }

    /**
     * @notice a gas-optimized version of lastPremium
     */
    function premiumFromPoolAccount() internal view returns (int256) {
        int256 p = fairPriceFromPoolAccount().toInt256();
        p = p.sub(fundingState.lastIndexPrice.toInt256());
        return p;
    }

    /**
     * @notice Assert that the given trader is safe.
     *
     * A trader must at least MM-safe. If the trader is opening positions, it also needs to be IM-safe.
     *
     * @param trader The trader.
     * @param opened Non zero if the trader is opening positions.
     */
    function mustSafe(address trader, uint256 opened) internal {
        // perpetual.markPrice is a little different from ours
        uint256 perpetualMarkPrice = perpetualProxy.markPrice();
        if (opened > 0) {
            require(perpetualProxy.isIMSafeWithPrice(trader, perpetualMarkPrice), "im unsafe");
        }
        require(perpetualProxy.isSafeWithPrice(trader, perpetualMarkPrice), "sender unsafe");
        require(perpetualProxy.isSafeWithPrice(tradingAccount(), perpetualMarkPrice), "amm unsafe");
    }

    /**
     * @notice Mint Share token to a given trader.
     *
     * @param trader The trader.
     * @param amount Tokens.
     */
    function mintShareTokenTo(address trader, uint256 amount) internal {
        require(shareToken.mint(trader, amount), "mint failed");
    }

    /**
     * @notice Burn Share token from a given trader.
     * @param trader The trader.
     * @param amount Tokens.
     */
    function burnShareTokenFrom(address trader, uint256 amount) internal {
        require(shareToken.burn(trader, amount), "burn failed");
    }

    /**
     * @notice Init the fundingState. This function should be called before a funding().
     *
     * @param newIndexPrice Index price.
     * @param blockTime Use this timestamp instead of the time that the index price is generated, because this is the first initialization.
     */
    function initFunding(uint256 newIndexPrice, uint256 blockTime) private {
        require(fundingState.lastFundingTime == 0, "already initialized");
        fundingState.lastFundingTime = blockTime;
        fundingState.lastIndexPrice = newIndexPrice;
        fundingState.lastPremium = 0;
        fundingState.lastEMAPremium = 0;
    }

    /**
     * @notice current* functions need a funding() before return our states.
     *
     * Note: Will skip funding() other than NORMAL
     *
     * There are serveral conditions for change the funding state:
     * Condition 1: time.
     * Condition 2: indexPrice.
     * Condition 3: fairPrice. This condition is not covered in this function. We hand over to forceFunding.
     */
    function funding() internal {
        if (perpetualProxy.status() != LibTypes.Status.NORMAL) {
            return;
        }
        uint256 blockTime = getBlockTimestamp();
        uint256 newIndexPrice;
        uint256 newIndexTimestamp;
        (newIndexPrice, newIndexTimestamp) = indexPrice();
        if (
            blockTime != fundingState.lastFundingTime || // condition 1
            newIndexPrice != fundingState.lastIndexPrice || // condition 2, especially when updateIndex and buy/sell are in the same block
            newIndexTimestamp > fundingState.lastFundingTime // condition 2
        ) {
            forceFunding(blockTime, newIndexPrice, newIndexTimestamp);
        }
    }

    /**
     * @notice Update fundingState without checking whether the funding condition changes.
     *
     * This function also splits the funding process into 2 parts:
     * 1. funding from [lastFundingTime, lastIndexTimestamp)
     * 2. funding from [lastIndexTimestamp, blockTime)
     *
     */
    function forceFunding() internal {
        require(perpetualProxy.status() == LibTypes.Status.NORMAL, "wrong perpetual status");
        uint256 blockTime = getBlockTimestamp();
        uint256 newIndexPrice;
        uint256 newIndexTimestamp;
        (newIndexPrice, newIndexTimestamp) = indexPrice();
        forceFunding(blockTime, newIndexPrice, newIndexTimestamp);
    }

    /**
     * @notice Update fundingState without checking whether the funding condition changes.
     *
     * This function also splits the funding process into 2 parts:
     * 1. funding from [lastFundingTime, lastIndexTimestamp)
     * 2. funding from [lastIndexTimestamp, blockTime)
     *
     * @param blockTime The real end time.
     * @param newIndexPrice The latest index price.
     * @param newIndexTimestamp The timestamp of the latest index.
     */
    function forceFunding(uint256 blockTime, uint256 newIndexPrice, uint256 newIndexTimestamp) private {
        if (fundingState.lastFundingTime == 0) {
            // funding initialization required. but in this case, it's safe to just do nothing and return
            return;
        }
        if (newIndexTimestamp > fundingState.lastFundingTime) {
            // the 1st update
            nextStateWithTimespan(newIndexPrice, newIndexTimestamp);
        }
        // the 2nd update;
        nextStateWithTimespan(newIndexPrice, blockTime);

        emit UpdateFundingRate(fundingState);
    }

    /**
     * @notice Update fundingState from the lastFundingTime to the given time.
     *
     * This function also adds Acc / (8*3600) into accumulatedFundingPerContract, where Acc is accumulated
     * funding payment per position since lastFundingTime
     *
     * @param newIndexPrice New index price.
     * @param endTimestamp The given end time.
     */
    function nextStateWithTimespan(
        uint256 newIndexPrice,
        uint256 endTimestamp
    ) private {
        require(fundingState.lastFundingTime != 0, "funding initialization required");
        require(endTimestamp >= fundingState.lastFundingTime, "time steps (n) must be positive");

        // update ema
        if (fundingState.lastFundingTime != endTimestamp) {
            int256 timeDelta = endTimestamp.sub(fundingState.lastFundingTime).toInt256();
            int256 acc;
            (fundingState.lastEMAPremium, acc) = getAccumulatedFunding(
                timeDelta,
                fundingState.lastEMAPremium,
                fundingState.lastPremium,
                fundingState.lastIndexPrice.toInt256() // ema is according to the old index
            );
            fundingState.accumulatedFundingPerContract = fundingState.accumulatedFundingPerContract.add(
                acc.div(FUNDING_PERIOD)
            );
            fundingState.lastFundingTime = endTimestamp;
        }

        // always update
        fundingState.lastIndexPrice = newIndexPrice; // should update before premium()
        fundingState.lastPremium = premiumFromPoolAccount();
    }

    /**
     * @notice Solve t in emaPremium == y equation
     *
     * @param y Required function output.
     * @param v0 LastEMAPremium.
     * @param _lastPremium LastPremium.
     */
    function timeOnFundingCurve(
        int256 y,
        int256 v0,
        int256 _lastPremium
    )
        internal
        view
        returns (
            int256 t // normal int, not WAD
        )
    {
        require(y != _lastPremium, "no solution 1 on funding curve");
        t = y.sub(_lastPremium);
        t = t.wdiv(v0.sub(_lastPremium));
        require(t > 0, "no solution 2 on funding curve");
        require(t < LibMathSigned.WAD(), "no solution 3 on funding curve");
        t = t.wln();
        t = t.wdiv(emaAlpha2Ln);
        t = t.ceil(LibMathSigned.WAD()) / LibMathSigned.WAD();
    }

    /**
     * @notice Sum emaPremium curve between [x, y)
     *
     * @param x Begin time. normal int, not WAD.
     * @param y End time. normal int, not WAD.
     * @param v0 LastEMAPremium.
     * @param _lastPremium LastPremium.
     */
    function integrateOnFundingCurve(
        int256 x,
        int256 y,
        int256 v0,
        int256 _lastPremium
    ) internal view returns (int256 r) {
        require(x <= y, "integrate reversed");
        r = v0.sub(_lastPremium);
        r = r.wmul(emaAlpha2.wpowi(x).sub(emaAlpha2.wpowi(y)));
        r = r.wdiv(governance.emaAlpha);
        r = r.add(_lastPremium.mul(y.sub(x)));
    }

   /**
     * @notice The intermediate variables required by getAccumulatedFunding. This is only used to move stack
     *         variables to storage variables.
     */
    struct AccumulatedFundingCalculator {
        int256 vLimit;
        int256 vDampener;
        int256 t1; // normal int, not WAD
        int256 t2; // normal int, not WAD
        int256 t3; // normal int, not WAD
        int256 t4; // normal int, not WAD
    }

    /**
     * @notice Calculate the `Acc`. Sigma the funding rate curve while considering the limit and dampener. There are
     *         4 boundary points on the curve (-GovMarkPremiumLimit, -GovFundingDampener, +GovFundingDampener, +GovMarkPremiumLimit)
     *         which segment the curve into 5 parts, so that the calculation can be arranged into 5 * 5 = 25 cases.
     *         In order to reduce the amount of calculation, the code is expanded into 25 branches.
     *
     * @param n Time span. normal int, not WAD.
     * @param v0 LastEMAPremium.
     * @param _lastPremium LastPremium.
     * @param _lastIndexPrice LastIndexPrice.
     */
    function getAccumulatedFunding(
        int256 n,
        int256 v0,
        int256 _lastPremium,
        int256 _lastIndexPrice
    )
        internal
        view
        returns (
            int256 vt, // new LastEMAPremium
            int256 acc
        )
    {
        require(n > 0, "we can't go back in time");
        AccumulatedFundingCalculator memory ctx;
        vt = v0.sub(_lastPremium);
        vt = vt.wmul(emaAlpha2.wpowi(n));
        vt = vt.add(_lastPremium);
        ctx.vLimit = governance.markPremiumLimit.wmul(_lastIndexPrice);
        ctx.vDampener = governance.fundingDampener.wmul(_lastIndexPrice);
        if (v0 <= -ctx.vLimit) {
            // part A
            if (vt <= -ctx.vLimit) {
                acc = (-ctx.vLimit).add(ctx.vDampener).mul(n);
            } else if (vt <= -ctx.vDampener) {
                ctx.t1 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                acc = (-ctx.vLimit).mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, n, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(n));
            } else if (vt <= ctx.vDampener) {
                ctx.t1 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                ctx.t2 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                acc = (-ctx.vLimit).mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, ctx.t2, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(ctx.t2));
            } else if (vt <= ctx.vLimit) {
                ctx.t1 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                ctx.t2 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                acc = (-ctx.vLimit).mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, ctx.t2, v0, _lastPremium));
                acc = acc.add(integrateOnFundingCurve(ctx.t3, n, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(ctx.t2.sub(n).add(ctx.t3)));
            } else {
                ctx.t1 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                ctx.t2 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t4 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                acc = (-ctx.vLimit).mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, ctx.t2, v0, _lastPremium));
                acc = acc.add(integrateOnFundingCurve(ctx.t3, ctx.t4, v0, _lastPremium));
                acc = acc.add(ctx.vLimit.mul(n.sub(ctx.t4)));
                acc = acc.add(ctx.vDampener.mul(ctx.t2.sub(n).add(ctx.t3)));
            }
        } else if (v0 <= -ctx.vDampener) {
            // part B
            if (vt <= -ctx.vLimit) {
                ctx.t4 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t4, v0, _lastPremium);
                acc = acc.add((-ctx.vLimit).mul(n.sub(ctx.t4)));
                acc = acc.add(ctx.vDampener.mul(n));
            } else if (vt <= -ctx.vDampener) {
                acc = integrateOnFundingCurve(0, n, v0, _lastPremium);
                acc = acc.add(ctx.vDampener.mul(n));
            } else if (vt <= ctx.vDampener) {
                ctx.t2 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t2, v0, _lastPremium);
                acc = acc.add(ctx.vDampener.mul(ctx.t2));
            } else if (vt <= ctx.vLimit) {
                ctx.t2 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t2, v0, _lastPremium);
                acc = acc.add(integrateOnFundingCurve(ctx.t3, n, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(ctx.t2.sub(n).add(ctx.t3)));
            } else {
                ctx.t2 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t4 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t2, v0, _lastPremium);
                acc = acc.add(integrateOnFundingCurve(ctx.t3, ctx.t4, v0, _lastPremium));
                acc = acc.add(ctx.vLimit.mul(n.sub(ctx.t4)));
                acc = acc.add(ctx.vDampener.mul(ctx.t2.sub(n).add(ctx.t3)));
            }
        } else if (v0 <= ctx.vDampener) {
            // part C
            if (vt <= -ctx.vLimit) {
                ctx.t3 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t4 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                acc = integrateOnFundingCurve(ctx.t3, ctx.t4, v0, _lastPremium);
                acc = acc.add((-ctx.vLimit).mul(n.sub(ctx.t4)));
                acc = acc.add(ctx.vDampener.mul(n.sub(ctx.t3)));
            } else if (vt <= -ctx.vDampener) {
                ctx.t3 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                acc = integrateOnFundingCurve(ctx.t3, n, v0, _lastPremium);
                acc = acc.add(ctx.vDampener.mul(n.sub(ctx.t3)));
            } else if (vt <= ctx.vDampener) {
                acc = 0;
            } else if (vt <= ctx.vLimit) {
                ctx.t3 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                acc = integrateOnFundingCurve(ctx.t3, n, v0, _lastPremium);
                acc = acc.sub(ctx.vDampener.mul(n.sub(ctx.t3)));
            } else {
                ctx.t3 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t4 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                acc = integrateOnFundingCurve(ctx.t3, ctx.t4, v0, _lastPremium);
                acc = acc.add(ctx.vLimit.mul(n.sub(ctx.t4)));
                acc = acc.sub(ctx.vDampener.mul(n.sub(ctx.t3)));
            }
        } else if (v0 <= ctx.vLimit) {
            // part D
            if (vt <= -ctx.vLimit) {
                ctx.t2 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t4 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t2, v0, _lastPremium);
                acc = acc.add(integrateOnFundingCurve(ctx.t3, ctx.t4, v0, _lastPremium));
                acc = acc.add((-ctx.vLimit).mul(n.sub(ctx.t4)));
                acc = acc.add(ctx.vDampener.mul(n.sub(ctx.t3).sub(ctx.t2)));
            } else if (vt <= -ctx.vDampener) {
                ctx.t2 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t2, v0, _lastPremium);
                acc = acc.add(integrateOnFundingCurve(ctx.t3, n, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(n.sub(ctx.t3).sub(ctx.t2)));
            } else if (vt <= ctx.vDampener) {
                ctx.t2 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t2, v0, _lastPremium);
                acc = acc.sub(ctx.vDampener.mul(ctx.t2));
            } else if (vt <= ctx.vLimit) {
                acc = integrateOnFundingCurve(0, n, v0, _lastPremium);
                acc = acc.sub(ctx.vDampener.mul(n));
            } else {
                ctx.t4 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                acc = integrateOnFundingCurve(0, ctx.t4, v0, _lastPremium);
                acc = acc.add(ctx.vLimit.mul(n.sub(ctx.t4)));
                acc = acc.sub(ctx.vDampener.mul(n));
            }
        } else {
            // part E
            if (vt <= -ctx.vLimit) {
                ctx.t1 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                ctx.t2 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                ctx.t4 = timeOnFundingCurve(-ctx.vLimit, v0, _lastPremium);
                acc = ctx.vLimit.mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, ctx.t2, v0, _lastPremium));
                acc = acc.add(integrateOnFundingCurve(ctx.t3, ctx.t4, v0, _lastPremium));
                acc = acc.add((-ctx.vLimit).mul(n.sub(ctx.t4)));
                acc = acc.add(ctx.vDampener.mul(n.sub(ctx.t3).sub(ctx.t2)));
            } else if (vt <= -ctx.vDampener) {
                ctx.t1 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                ctx.t2 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                ctx.t3 = timeOnFundingCurve(-ctx.vDampener, v0, _lastPremium);
                acc = ctx.vLimit.mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, ctx.t2, v0, _lastPremium));
                acc = acc.add(integrateOnFundingCurve(ctx.t3, n, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(n.sub(ctx.t3).sub(ctx.t2)));
            } else if (vt <= ctx.vDampener) {
                ctx.t1 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                ctx.t2 = timeOnFundingCurve(ctx.vDampener, v0, _lastPremium);
                acc = ctx.vLimit.mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, ctx.t2, v0, _lastPremium));
                acc = acc.add(ctx.vDampener.mul(-ctx.t2));
            } else if (vt <= ctx.vLimit) {
                ctx.t1 = timeOnFundingCurve(ctx.vLimit, v0, _lastPremium);
                acc = ctx.vLimit.mul(ctx.t1);
                acc = acc.add(integrateOnFundingCurve(ctx.t1, n, v0, _lastPremium));
                acc = acc.sub(ctx.vDampener.mul(n));
            } else {
                acc = ctx.vLimit.sub(ctx.vDampener).mul(n);
            }
        }
    } // getAccumulatedFunding
}
