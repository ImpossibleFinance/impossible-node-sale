import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract } from 'ethers'
import { computeMerkleProofByAddress, computeMerkleRoot } from './merkleWhitelist'
import { computeMerkleRootWithAllocation } from './test-IFFixedSale'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { getBlockTime, mineTimeDelta } from './helpers'

describe('TieredSale Contract', function () {
    let tieredSale: Contract
    let deployer: SignerWithAddress, operator: SignerWithAddress, user: SignerWithAddress, referrer: SignerWithAddress
    let startTime: number
    let endTime: number
    let paymentToken: Contract
    let saleToken: Contract
    let wallets: SignerWithAddress[]
    let fundAmount = 1000  // 1000 tokens


    const tierId = 'whitelist1'
    const promoCode = 'SAVE20'

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
        tieredSale = await TieredSaleFactory.deploy(paymentToken.address, saleToken.address, startTime, endTime, await deployer.getAddress())

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
            await expect(tieredSale.connect(user).setTier('silver', 50, 3000, 50, ethers.utils.formatBytes32String(''), false, true, 5))
                .to.be.revertedWith('Not authorized')
        })
    })

    describe('tiered sale: tier management', function () {
        it('should allow operator to create a tier', async function () {
            const tierId = 'tier1'
            await tieredSale.connect(deployer).setTier(tierId, ethers.utils.parseEther('1'), 1000, 10, ethers.constants.HashZero, false, true, 5)
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
            await tieredSale.connect(operator).setTier(
                tierId,  // tierId
                ethers.utils.parseEther('1'),  // price
                maxTotalPurchasable,  // maxTotalPurchasable
                maxPurchasePerWallet,  // maxPurchasePerWallet
                computeMerkleRoot(leaves),  // merkleRoot
                false,  // isWhitelisted
                true,  // isPublic
                5  // bonusPercentage
            ).then((tx: { wait: () => any }) => tx.wait())

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
            await expect(tieredSale.connect(referrer).withdrawReferralRewards(promoCode))
                .to.emit(tieredSale, 'ReferralRewardWithdrawn')
                .withArgs(referrer.address, expectedOwnerEarnings) // Based on the previous test's expected earnings
        })

        it('should allow purchase from any wallet if whitelistRootHash is empty', async function () {
            await tieredSale.connect(operator).setTier(
                tierId,  // tierId
                ethers.utils.parseEther('1'),  // price
                maxTotalPurchasable,  // maxTotalPurchasable
                maxPurchasePerWallet,  // maxPurchasePerWallet
                ethers.constants.HashZero, // empty root hash
                false,  // isWhitelisted
                true,  // isPublic
                5  // bonusPercentage
            ).then((tx: { wait: () => any }) => tx.wait())

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
            await tieredSale.connect(deployer).setTier(tierId, price, allocationAmount, allocationAmount, ethers.constants.HashZero, true, true, 0)
            // Attempt to purchase in a halted tier should fail
            await expect(tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                1,
                [],
                promoCode,
                allocationAmount
            )).to.be.revertedWith('Purchases in this tier are currently halted')
    
            // Resuming the tier
            await tieredSale.connect(deployer).setTier(tierId, price, allocationAmount, allocationAmount, ethers.constants.HashZero, false, true, 0)
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
            await tieredSale.connect(deployer).setTier(tierId, price, allocationAmount, allocationAmount, ethers.constants.HashZero, false, true, 0)
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
            const numPurchase = 1
            await tieredSale.connect(deployer).setTier(tierId, price, allocationAmount, allocationAmount, ethers.constants.HashZero, false, true, 0)
            await tieredSale.connect(user).whitelistedPurchaseInTierWithCode(
                tierId,
                numPurchase,
                [],
                promoCode,
                allocationAmount,
            )
            mineTimeDelta(endTime - await getBlockTime())
            const balanceBefore = await saleToken.balanceOf(deployer.address)
            await tieredSale.connect(deployer).cash()
            const balanceAfter = await saleToken.balanceOf(deployer.address)
    
            expect(balanceAfter.sub(balanceBefore)).to.be.equals((fundAmount - numPurchase).toString())
        })

    })
})
