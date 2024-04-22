import '@nomiclabs/hardhat-ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { getBlockTime, mineNext, mineTimeDelta, setAutomine } from './helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract } from 'ethers'
import { INPUT_SHOULD_NOT_BE_0_WHEN_SALE_PRIVE_IS_0 } from './reverts/msg-IFSale'

export default describe('IF Fixed Sale Deployment', function () {
  this.timeout(0)

  // deployer address
  let owner: SignerWithAddress
  let buyer: SignerWithAddress
  let seller: SignerWithAddress
  let casher: SignerWithAddress

  // contract vars
  let StakeToken: Contract
  let PaymentToken: Contract
  let SaleToken: Contract
  let IFAllocationMaster: Contract

  const maxTotalDeposit = '25000000000000000000000000' // max deposit

  this.beforeAll(async () => {
    await setAutomine(false)
  })

  this.afterAll(async () => {
    await setAutomine(true)
  })

  beforeEach(async () => {
    // get test accounts
    owner = (await ethers.getSigners())[0]
    buyer = (await ethers.getSigners())[1]
    seller = (await ethers.getSigners())[2]
    casher = (await ethers.getSigners())[3]

    // deploy test tokens
    const TestTokenFactory = await ethers.getContractFactory('GenericToken')
    StakeToken = await TestTokenFactory.connect(buyer).deploy(
      'Test Stake Token',
      'STAKE',
      '21000000000000000000000000' // 21 million * 10**18
    )
    PaymentToken = await TestTokenFactory.connect(buyer).deploy(
      'Test Payment Token',
      'PAY',
      '21000000000000000000000000' // 21 million * 10**18
    )
    SaleToken = await TestTokenFactory.connect(seller).deploy(
      'Test Sale Token',
      'SALE',
      '21000000000000000000000000' // 21 million * 10**18
    )
    mineNext()
  })

  // TokenAddress = PaymentAddress
  it('should failed, saleToken = paymentToken', async () => {
    const IFFixedSaleFactory = await ethers.getContractFactory(
      'IFFixedSale'
    )
    const currTime = await getBlockTime()
    await expect(
      IFFixedSaleFactory.deploy(
        1,
        seller.address,
        SaleToken.address, // test sale token = payment token
        SaleToken.address,
        currTime + 50,
        currTime + 250,
        maxTotalDeposit
      )
    ).to.be.revertedWith('saleToken = paymentToken')
  })

  // TokenAddress = PaymentAddress
  it('should failed when salePrice != 0, paymentToken = 0', async () => {
    const IFFixedSaleFactory = await ethers.getContractFactory(
      'IFFixedSale'
    )
    const currTime = await getBlockTime()
    await expect(
      IFFixedSaleFactory.deploy(
        1, // salePrice not 0
        seller.address,
        ethers.constants.AddressZero,
        SaleToken.address,
        currTime + 50,
        currTime + 250,
        maxTotalDeposit
      )
    ).to.be.revertedWith(INPUT_SHOULD_NOT_BE_0_WHEN_SALE_PRIVE_IS_0)
  })

  // TokenAddress = PaymentAddress
  it('should failed when salePrice != 0, maxTotalPayment = 0', async () => {
    const IFFixedSaleFactory = await ethers.getContractFactory(
      'IFFixedSale'
    )
    const currTime = await getBlockTime()
    await expect(
      IFFixedSaleFactory.deploy(
        1, // sale price 0
        seller.address,
        PaymentToken.address,
        SaleToken.address,
        currTime + 50,
        currTime + 250,
        0 // maxTotalPayment 0
      )
    ).to.be.revertedWith(INPUT_SHOULD_NOT_BE_0_WHEN_SALE_PRIVE_IS_0)
  })
})
