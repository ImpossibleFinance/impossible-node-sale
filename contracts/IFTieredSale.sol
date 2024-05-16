// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./IFFundable.sol";
import "./IFWhitelistable.sol";

contract TieredSale is IFFundable, IFWhitelistable {
    using SafeERC20 for ERC20;

    struct Tier {
        uint256 price;
        uint256 maxTotalPurchasable;
        uint256 maxAllocationPerWallet;
        bytes32 whitelistRootHash;
        bool isHalt;
        bool isIntegerSale;
    }

    struct PromoCode {
        uint discountPercentage;
        address referrer;
        uint256 totalReferralRewards;
    }

    mapping(string => Tier) public tiers;
    mapping(string => mapping(address => uint256)) public purchasedAmountPerTier;
    mapping(string => uint256) public totalPurchasedAmount;
    mapping(string => PromoCode) public promoCodes;
    mapping(address => uint256) public claimableTokens;

    event TierUpdated(string tierId);
    event PurchasedInTier(address indexed buyer, string tierId, uint256 amount, string promoCode);
    event ReferralRewardWithdrawn(address referrer, uint256 amount);

    constructor(
        ERC20 _paymentToken,
        uint256 _startTime,
        uint256 _endTime,
        address _funder
    )
        IFFundable(_paymentToken, _paymentToken, _startTime, _endTime, _funder)
        IFWhitelistable()
    {}

    function setTier(
        string memory _tierId,
        uint256 _price,
        uint256 _maxTotalPurchasable,
        uint256 _maxAllocationPerWallet,
        bytes32 _whitelistRootHash,
        bool _isHalt,
        bool _isIntegerSale
    ) public onlyOwner {
        tiers[_tierId] = Tier({
            price: _price,
            maxTotalPurchasable: _maxTotalPurchasable,
            maxAllocationPerWallet: _maxAllocationPerWallet,
            whitelistRootHash: _whitelistRootHash,
            isHalt: _isHalt,
            isIntegerSale: _isIntegerSale
        });

        emit TierUpdated(_tierId);
    }

    function addPromoCode(string memory _code, uint _discountPercentage, address _referrer) public onlyOwner {
        require(_discountPercentage <= 100, "Invalid discount percentage");
        promoCodes[_code] = PromoCode({
            discountPercentage: _discountPercentage,
            referrer: _referrer,
            totalReferralRewards: 0
        });
    }

    function whitelistedPurchaseInTierWithCode(
        string memory _tierId,
        uint256 _amount,
        bytes32[] calldata _merkleProof,
        string memory _promoCode,
        uint256 _allocation
    ) public {
        require(MerkleProof.verify(_merkleProof, tiers[_tierId].whitelistRootHash, keccak256(abi.encodePacked(msg.sender, _allocation))), "Invalid proof");
        require(purchasedAmountPerTier[_tierId][msg.sender] + _amount <= _allocation, "Purchase exceeds allocation");
        uint discount = bytes(_promoCode).length > 0 ? promoCodes[_promoCode].discountPercentage : 0;
        uint discountedPrice = tiers[_tierId].price * (100 - discount) / 100;
        executePurchase(_tierId, _amount, discountedPrice, _promoCode);
    }

    function executePurchase(string memory _tierId, uint256 _amount, uint256 _price, string memory _promoCode) private {
        Tier storage tier = tiers[_tierId];
        require(!tier.isHalt, "Purchases in this tier are currently halted");
        _validatePromoCode(_promoCode);
        if (tier.isIntegerSale) {
            require(_amount % tier.price == 0, "Can only purchase integer amounts in this tier");
        }
        require(
            purchasedAmountPerTier[_tierId][msg.sender] + _amount <= tier.maxAllocationPerWallet,
            "Amount exceeds wallet's maximum allocation for this tier"
        );
        require(
            saleTokenPurchased + _amount <= tier.maxTotalPurchasable,
            "Amount exceeds tier's maximum total purchasable"
        );

        purchasedAmountPerTier[_tierId][msg.sender] += _amount;
        totalPurchasedAmount[msg.sender] += _amount;
        saleTokenPurchased += _amount;
        claimableTokens[msg.sender] += _amount;
        uint256 totalCost = _amount * _price;
        paymentToken.safeTransferFrom(msg.sender, address(this), totalCost);

        // Calculate and allocate referral reward
        uint256 referralReward = totalCost * globalReferralRewardPercentage / 100;
        promoCodes[_promoCode].totalReferralRewards += referralReward;

        emit PurchasedInTier(msg.sender, _tierId, _amount, _promoCode);
    }

    function cash() external onlyOwner {
        uint256 totalClaimable = getCurrentClaimableToken();
        require(totalClaimable > 0, "No tokens available to cash");

        paymentToken.safeTransfer(owner(), totalClaimable);
        emit Cash(owner(), totalClaimable, 0);
    }

    function getCurrentClaimableToken() public view returns (uint256) {
        uint256 totalClaimable = 0;
        for (uint i = 0; i < tiers.length; i++) {
            totalClaimable += claimableTokens[tiers[i]];
        }
        return totalClaimable;
    }

    function withdrawReferralRewards(string memory _promoCode) public {
        require(bytes(_promoCode).length > 0, "Invalid promo code");
        PromoCode storage promo = promoCodes[_promoCode];
        _validatePromoCode(_promoCode);
        require(msg.sender == promo.referrer, "Not the referrer");
        require(promo.totalReferralRewards > 0, "No rewards available");

        uint256 reward = promo.totalReferralRewards;
        promo.totalReferralRewards = 0;
        paymentToken.safeTransfer(msg.sender, reward);

        emit ReferralRewardWithdrawn(msg.sender, reward);
    }

    function _validatePromoCode(string memory _promoCode) internal view {
        if (_promoCode.length != 42) {
            return;
        }
        address promoCodeAddress;
        assembly {
            promoCodeAddress := mload(add(_promoCode, 20))
        }
        // if the promo code is an address, check if it has purchased any node
        require(totalPurchasedAmount[promoCodeAddress] > 0, "Invalid promo code");
    }
}