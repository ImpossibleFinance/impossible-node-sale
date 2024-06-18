import { ethers } from 'hardhat'
import { expect } from 'chai'
import { BigNumber, Contract } from 'ethers'
import { computeMerkleProofByAddress, computeMerkleRoot } from './merkleWhitelist'
import { computeMerkleRootWithAllocation } from './test-IFFixedSale'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { getBlockTime, mineTimeDelta } from './helpers'

// Define a type for the tier settings
type TierSettings = {
    tierId: string,
    price: BigNumber;
    maxTotalPurchasable: BigNumber | number;
    maxAllocationPerWallet: BigNumber | number;
    whitelistRootHash: string;
    bonusPercentage: number;
    isHalt: boolean;
    allowPromoCode: boolean;
    allowWalletPromoCode: boolean;
    startTime: number;
    endTime: number;
};


function prepareTierArgs(tierSettings: TierSettings) {
    return [
        tierSettings.tierId,
        tierSettings.price,
        tierSettings.maxTotalPurchasable,
        tierSettings.maxAllocationPerWallet,
        tierSettings.whitelistRootHash,
        tierSettings.bonusPercentage,
        tierSettings.isHalt,
        tierSettings.allowPromoCode,
        tierSettings.allowWalletPromoCode,
        tierSettings.startTime,
        tierSettings.endTime
    ]
}

describe('TieredSale Contract', function () {
    let tieredSale: Contract
    let deployer: SignerWithAddress, operator: SignerWithAddress, user: SignerWithAddress, referrer: SignerWithAddress
    let startTime: number
    let endTime: number
    let paymentToken: Contract
    let saleToken: Contract
    let wallets: SignerWithAddress[]
    const fundAmount = 1000  // 1000 tokens
    const price = ethers.utils.parseEther('1')

    const tierId = 'whitelist1'
    const promoCode = 'SAVE20'

    const defaultTierSettings: TierSettings = {
        tierId: tierId,
        price: ethers.utils.parseEther('1'),
        maxTotalPurchasable: 1000,
        maxAllocationPerWallet: 10,
        whitelistRootHash: ethers.constants.HashZero,
        bonusPercentage: 5,
        isHalt: false,
        allowPromoCode: true,
        allowWalletPromoCode: true,
        startTime: 0,
        endTime: 2**31 - 1, // max of unix timestamp
    }

    const operatorRole = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('OPERATOR_ROLE'))

    beforeEach(async function () {
        [deployer, operator, user, referrer] = await ethers.getSigners()
        wallets = [deployer, operator, user, referrer]

        // Mock the ERC20 payment token
        const TokenPayment = await ethers.getContractFactory('GenericToken')
        paymentToken = await TokenPayment.deploy('Mock Token', 'MTKP', 18)
        await paymentToken.deployed()

        // iterate over the wallets and mint some tokens for each
        for (const wallet of wallets) {
            await paymentToken.mint(await wallet.getAddress(), ethers.utils.parseEther('10000')).then((tx: { wait: () => any }) => tx.wait())
        }

        // Mock the ERC20 Sale token
        const TokenSale = await ethers.getContractFactory('GenericToken')
        saleToken = await TokenSale.deploy('Mock Token Sale', 'MTKS', 18)
        await saleToken.deployed()

        startTime = (await ethers.provider.getBlock('latest')).timestamp + 3600 // 1 hr later
        endTime = startTime + 86400 // 24 hours later

        // Deploy the TieredSale contract
        const TieredSaleFactory = await ethers.getContractFactory('IFTieredSale')
        tieredSale = await TieredSaleFactory.deploy(paymentToken.address, saleToken.address, startTime, endTime)

        await tieredSale.deployed()

        // Mint sale tokens to the TieredSale contract to cover possible purchases
        await saleToken.mint(tieredSale.address, fundAmount).then((tx: { wait: () => any }) => tx.wait())

        // Setup roles
        await tieredSale.addOperator(operator.getAddress()).then((tx: { wait: () => any }) => tx.wait())
    })

    describe('tiered sale: access control', function () {
        it('should set deployer as the default admin', async function () {
            expect(await tieredSale.hasRole(await tieredSale.DEFAULT_ADMIN_ROLE(), await deployer.getAddress())).to.be.true
        })

        it('should allow deployer to add an operator', async function () {
            await tieredSale.connect(deployer).addOperator(await operator.getAddress())
            expect(await tieredSale.hasRole(operatorRole, await operator.getAddress())).to.be.true
        })
        it('should fail for unauthorized tier setup', async function () {
            // override default tier settings
            await expect(tieredSale.connect(user).setTier(...prepareTierArgs(defaultTierSettings)))
                .to.be.revertedWith('Not authorized')
        })
    })

    describe('tiered sale: tier management', function () {
        it('should allow operator to create a tier', async function () {
            const tierId = 'tier1'
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tierId,
                price: ethers.utils.parseEther('1'),
                maxTotalPurchasable: 1000,
            })).then((tx: { wait: () => any }) => tx.wait())
            const tier = await tieredSale.tiers(tierId)
            expect(tier.price).to.equal(ethers.utils.parseEther('1'))
            expect(tier.maxTotalPurchasable).to.equal(1000)
        })
    })

    describe('tiered sale: promo code management', function () {
        it('Should allow adding a promo code', async function () {
            await expect(tieredSale.connect(operator).addPromoCode('SAVE20', 20, user.getAddress(), operator.getAddress()))
                .to.emit(tieredSale, 'PromoCodeAdded')
        })

        it('Should fail when adding a promo code with invalid discount', async function () {
            await expect(tieredSale.connect(operator).addPromoCode('TOOMUCH', 101, user.getAddress(), operator.getAddress()))
                .to.be.revertedWith('Invalid discount percentage')
        })
    })
    describe('tiered sale: purchasing in tiers with promo codes', function () {
        const maxPurchasePerWallet = 50
        const maxTotalPurchasable = maxPurchasePerWallet * 2
        const nodeAllocated = maxPurchasePerWallet + 1  // to test buying more than the max allowed per wallet
        const price = ethers.utils.parseEther('1')  // price
        const discount = 20  // discount percentage
        const allocationAmount = ethers.utils.parseEther(nodeAllocated.toString())
        let leaves: string[], addressValMap: Map<string, string>

        this.beforeEach(async function () {
            [leaves, addressValMap] = computeMerkleRootWithAllocation(
                wallets,
                Array(wallets.length).fill(nodeAllocated)
            )
            const merkleRoot = computeMerkleRoot(leaves)
            await tieredSale.connect(operator).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                whitelistRootHash: merkleRoot,
            })).then((tx: { wait: () => any }) => tx.wait())

            await tieredSale.connect(operator).addPromoCode(promoCode, discount, referrer.address, operator.address).then((tx: { wait: () => any }) => tx.wait())

            await paymentToken.connect(user).approve(tieredSale.address, allocationAmount).then((tx: { wait: () => any }) => tx.wait())
        })
    
        it('should allow purchasing with a valid promo code and apply discount', async function () {
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,  // tierId
                3,  // amount
                computeMerkleProofByAddress(leaves, addressValMap, user.address),  // merkleProof
                promoCode,  // promoCode
                nodeAllocated  // allocation
            ).then((tx: { wait: () => any }) => tx.wait())

            const purchaseRecord = await tieredSale.purchasedAmountPerTier(tierId, user.getAddress())
            expect(purchaseRecord).to.equal(3)
        })

        it('should not allow purchasing beyond the maximum allocation per wallet', async function () {
            const tierId = 'maxAllocTier'
            await tieredSale.connect(operator).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tierId,
                maxAllocationPerWallet: maxPurchasePerWallet,
            })).then((tx: { wait: () => any }) => tx.wait())
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                maxPurchasePerWallet,
                computeMerkleProofByAddress(leaves, addressValMap, user.address),  // merkleProof
                promoCode,
                nodeAllocated
            )

            // Attempt to purchase more than the allowed per wallet
            await expect(tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                1,
                computeMerkleProofByAddress(leaves, addressValMap, user.address),  // merkleProof
                promoCode,
                nodeAllocated
            )).to.be.revertedWith('Amount exceeds wallet\'s maximum allocation for this tier')
        })

        it('should correctly track promo code usage and earnings', async function () {
            const numPurchase = 3
            const totalCost = price.mul(numPurchase)
            const costAfterDiscount = totalCost.mul(80).div(100)  // 20% discount
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                numPurchase,
                computeMerkleProofByAddress(leaves, addressValMap, user.address),  // merkleProof
                promoCode,
                nodeAllocated
            )

            const promo = await tieredSale.promoCodes(promoCode)

            const expectedOwnerEarnings = costAfterDiscount.mul(8 + 5).div(100) // 8% + 5% (bonus) of 3 ether
            const expectedMasterEarnings = costAfterDiscount.mul(2).div(100) // 2% of 3 ether

            expect(promo.promoCodeOwnerEarnings).to.equal(expectedOwnerEarnings)
            expect(promo.masterOwnerEarnings).to.equal(expectedMasterEarnings)
        })

        it('should allow withdrawal of referral rewards by the promo code owner', async function () {
            const numPurchase = 3
            const totalCost = price.mul(numPurchase)
            const costAfterDiscount = totalCost.mul(80).div(100)  // 20% discount

            const expectedOwnerEarnings = costAfterDiscount.mul(8 + 5).div(100) // 8% + 5% (bonus) of 3 ether
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                numPurchase,
                computeMerkleProofByAddress(leaves, addressValMap, user.address),  // merkleProof
                promoCode,
                nodeAllocated
            )

            // Withdraw earnings as the promo code owner
            await expect(tieredSale.connect(referrer).withdrawPromoCodelRewards(promoCode))
                .to.emit(tieredSale, 'ReferralRewardWithdrawn')
                .withArgs(referrer.address, expectedOwnerEarnings) // Based on the previous test's expected earnings
        })

        it('should allow purchase from any wallet if whitelistRootHash is empty', async function () {
            await tieredSale.connect(operator).setTier(...prepareTierArgs({
                ...defaultTierSettings,
            })).then((tx: { wait: () => any }) => tx.wait())

            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                1,
                computeMerkleProofByAddress(leaves, addressValMap, user.address),  // merkleProof
                promoCode,
                nodeAllocated
            )
        })

        it('should prevent purchases when tier is halted and allow when resumed', async function () {
            // Halting the tier
            await tieredSale.connect(deployer).updateIsHalt(tierId, true)
            // unset whitelist
            await tieredSale.connect(deployer).updateWhitelist(tierId, ethers.constants.HashZero)
            // Attempt to purchase in a halted tier should fail
            await expect(tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                1,
                [],
                promoCode,
                allocationAmount
            )).to.be.revertedWith('Purchases in this tier are currently halted')
    
            // Resuming the tier
            await tieredSale.connect(deployer).updateIsHalt(tierId, false)
            // Purchase in resumed tier should succeed
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                1,
                [],
                promoCode,
                allocationAmount,
            )
        })
    
        it('should allow to cash out payment tokens', async function () {
            await tieredSale.connect(operator).setTier(...prepareTierArgs({
                ...defaultTierSettings,
            })).then((tx: { wait: () => any }) => tx.wait())
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                1,
                [],
                promoCode,
                allocationAmount,
            )
            const balanceBefore = await paymentToken.balanceOf(deployer.address)
            await tieredSale.connect(deployer).cashPaymentToken(1)
            const balanceAfter = await paymentToken.balanceOf(deployer.address)
    
            expect(balanceAfter.sub(balanceBefore)).to.equal(1)
        })
    
        it('should allow to cash out sale tokens', async function () {
            const cashTier1 = 'cashTier1'
            const cashTier2 = 'cashTier2'
            const numPurchase = 20
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: cashTier1,
                maxTotalPurchasable: allocationAmount,
                maxAllocationPerWallet: allocationAmount,
            })).then((tx: { wait: () => any }) => tx.wait())
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                cashTier1,
                numPurchase,
                [],
                promoCode,
                allocationAmount,
            )
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: cashTier2,
                maxTotalPurchasable: allocationAmount,
                maxAllocationPerWallet: allocationAmount,
            })).then((tx: { wait: () => any }) => tx.wait())
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                cashTier2,
                numPurchase,
                [],
                promoCode,
                allocationAmount,
            )
            mineTimeDelta(endTime - await getBlockTime())
            const balanceBefore = await saleToken.balanceOf(deployer.address)
            await tieredSale.connect(deployer).cash()
            const balanceAfter = await saleToken.balanceOf(deployer.address)
    
            expect(balanceAfter.sub(balanceBefore)).to.be.equals((fundAmount - numPurchase * 2).toString())
        })

    })

    describe('tiered sale: sale scenarios', function () {
        it('should handle purchases from multiple tiers correctly', async function () {
            const tier1 = 'Public1'
            const tier2 = 'Public2'
            const amount1 = 1
            const amount2 = 2
        
            // Setup two tiers
            await tieredSale.connect(operator).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tier1,
                price: ethers.utils.parseEther('0.5'),
                maxTotalPurchasable: 100,
                maxAllocationPerWallet: 1000,
            }))
            await tieredSale.connect(operator).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tier2,
                price: ethers.utils.parseEther('1'),
                maxTotalPurchasable: 50,
                maxAllocationPerWallet: 1000,
            }))
        
            // Simulate purchases in both tiers
            await paymentToken.connect(user).approve(tieredSale.address, ethers.utils.parseEther('10'))
            await tieredSale.connect(user).whitelistedPurchaseInTier(tier1, amount1, [], 1000)
            await tieredSale.connect(user).whitelistedPurchaseInTier(tier2, amount2, [], 1000)
        
            // Check totals for each tier
            const totalPurchased1 = await tieredSale.saleTokenPurchasedByTier(tier1)
            const totalPurchased2 = await tieredSale.saleTokenPurchasedByTier(tier2)
            expect(totalPurchased1).to.equal(amount1)
            expect(totalPurchased2).to.equal(amount2)
        })
        it('should reject purchases with invalid promo codes', async function () {
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tierId,
            }))
            const invalidPromo = 'INVALID100'
            const amount = 1
        
            await paymentToken.connect(user).approve(tieredSale.address, ethers.utils.parseEther('1'))

            await expect(tieredSale.connect(user).whitelistedPurchaseInTierWithCode(tierId, amount, [], invalidPromo, 5)).to.be.revertedWith('Invalid promo code')
        })
        it('should allow a purchase that exactly matches the wallet allocation', async function () {
            const maxAllocation = 5
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tierId,
                price: ethers.utils.parseEther('1'),
                maxTotalPurchasable: 1000,
                maxAllocationPerWallet: maxAllocation,
            }))
        
            await paymentToken.connect(user).approve(tieredSale.address, ethers.utils.parseEther(maxAllocation.toString()))
            await tieredSale.connect(user).whitelistedPurchaseInTier(tierId, maxAllocation, [],  maxAllocation)
        
            const purchasedAmount = await tieredSale.purchasedAmountPerTier(tierId, user.getAddress())
            expect(purchasedAmount).to.equal(maxAllocation)
        })
        it('should prevent and allow purchases when tier is halted and resumed', async function () {
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tierId,
                isHalt: true,
            }))

            await paymentToken.connect(user).approve(tieredSale.address, ethers.utils.parseEther('1'))
        
            // Attempt to purchase in a halted tier
            await expect(tieredSale.connect(user).whitelistedPurchaseInTier(tierId, 1, [], 10))
                .to.be.revertedWith('Purchases in this tier are currently halted')
        
            // Resume the tier
            await tieredSale.connect(operator).updateIsHalt(tierId, false)
        
            // Attempt purchase again
            await tieredSale.connect(user).whitelistedPurchaseInTier(tierId, 1, [], 10)
            const purchasedAmount = await tieredSale.purchasedAmountPerTier(tierId, user.getAddress())
            expect(purchasedAmount).to.equal(1)
        })
        it('should accurately calculate and record referral rewards', async function () {
            const tierId = 'sale1'
            const purchaseAmount = 3 // 3 ETH
        
            await tieredSale.connect(deployer).setTier(...prepareTierArgs({
                ...defaultTierSettings,
                tierId: tierId,
                bonusPercentage: 10,
            }))
            const promoCode = 'DEAL10'
            const discount = 10 // 10% discount
        
            // Add a promo code
            await tieredSale.connect(operator).addPromoCode(promoCode, discount, referrer.address, operator.address)
        
            // Approve token amount
            await paymentToken.connect(user).approve(tieredSale.address, ethers.utils.parseEther('100'))
        
            // Purchase with a promo code
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(tierId, purchaseAmount, [], promoCode, 10)
        
            // Calculate expected earnings
            const discountedPrice = price.mul(100 - discount).div(100).mul( purchaseAmount)
            const baseEarnings = discountedPrice.mul(8).div(100) // 8% base owner earnings
            const bonusEarnings = discountedPrice.div(10) // 10% bonus
        
            const promo = await tieredSale.promoCodes(promoCode)
            expect(promo.promoCodeOwnerEarnings).to.equal(baseEarnings.add(bonusEarnings))
        })

    })
})
