import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Contract, Signer } from 'ethers'

describe('TieredSale Contract', function () {
    let tieredSale: Contract
    let deployer: Signer, operator: Signer, user: Signer
    let startTime: number
    let endTime: number
    let paymentToken: any
    let saleToken: any

    const operatorRole = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('OPERATOR_ROLE'))

    beforeEach(async function () {
        [deployer, operator, user] = await ethers.getSigners()

        // Mock the ERC20 payment token
        const TokenPayment = await ethers.getContractFactory('GenericToken')
        paymentToken = await TokenPayment.deploy('Mock Token', 'MTKP', 18)
        await paymentToken.deployed()

        // Mock the ERC20 Sale token
        const TokenSale = await ethers.getContractFactory('GenericToken')
        saleToken = await TokenSale.deploy('Mock Token Sale', 'MTKS', 18)
        await saleToken.deployed()

        startTime = (await ethers.provider.getBlock('latest')).timestamp + 3600 // 1 hr later
        endTime = startTime + 86400 // 24 hours later

        // Deploy the TieredSale contract
        const TieredSaleFactory = await ethers.getContractFactory('TieredSale')
        tieredSale = await TieredSaleFactory.deploy(paymentToken.address, saleToken.address, startTime, endTime, await deployer.getAddress())

        await tieredSale.deployed()
    })

    describe('tiered sale: access control', function () {
        it('should set deployer as the default admin', async function () {
            expect(await tieredSale.hasRole(await tieredSale.DEFAULT_ADMIN_ROLE(), await deployer.getAddress())).to.be.true
        })

        it('should allow deployer to add an operator', async function () {
            await tieredSale.connect(deployer).addOperator(await operator.getAddress())
            expect(await tieredSale.hasRole(operatorRole, await operator.getAddress())).to.be.true
        })
    })

    describe('tiered sale: tier Management', function () {
        beforeEach(async function () {
            await tieredSale.connect(deployer).addOperator(await operator.getAddress())
        })

        it('should allow operator to create a tier', async function () {
            const tierId = 'tier1'
            await tieredSale.connect(deployer).setTier(tierId, ethers.utils.parseEther('1'), 1000, 10, ethers.constants.HashZero, false, true, 5)
            const tier = await tieredSale.tiers(tierId)
            expect(tier.price).to.equal(ethers.utils.parseEther('1'))
            expect(tier.maxTotalPurchasable).to.equal(1000)
        })
    })

    // Add more tests for purchasing, promo codes, and other functionalities
})
