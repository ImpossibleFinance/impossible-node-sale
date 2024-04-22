import '@nomiclabs/hardhat-ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { computeMerkleProof, computeMerkleRoot, getAddressIndex } from './merkleWhitelist'
import IFSaleGeneralTest, { _ctx, _ctxFree, _ctxSale } from './IFSaleGeneralTest'
import { getBlockTime, mineNext, mineTimeDelta } from './helpers'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { EXCEED_MAX_PAYMENT, NO_TOKEN_TO_BE_WITHDRAWN, NOT_A_GIVEAWAY, NOT_WHITELIST_SETTER_OR_OWNER, USE_VESTED_WITHDRAW_GIVEAWAY } from './reverts/msg-IFSale'

function computeMerkleRootWithAllocation(signers: SignerWithAddress[], allocations: number[]): [string[], Map<string, string>]{
    const leaves: string[] = []
    const addressValMap = new Map()
    signers.forEach((s: SignerWithAddress, i: number) => {
        const amount = allocations[i].toString()
        const packed = ethers.utils.solidityPack(
          ['address', 'uint256'],
          [s.address.toLowerCase(), amount],
        )
        leaves.push(packed)
        addressValMap.set(s.address.toLowerCase(), packed)
      }
    )
    leaves.sort()
    return [leaves, addressValMap]
}

export default describe('IF Fixed Sale', function () {
  // unset timeout from the test
  this.timeout(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = _ctx
  const ctxFree: any = _ctxFree
  const ctxSale: any = _ctxSale

  const contractName = 'MockIFFixedSale'

  const generalTest = IFSaleGeneralTest
  generalTest(this, contractName, ctx, _ctxFree, _ctxSale)


  generalTest.prototype.it = it('can save allocation amount in merkle tree', async function () {
    const signers = await ethers.getSigners()
    const allocations = Array(signers.length).fill(1)
    const [leaves, addressValMap] = computeMerkleRootWithAllocation(signers, allocations)
    const merkleRoot = computeMerkleRoot(leaves)
    await ctx.IFFixedSale.connect(ctx.owner).setWhitelist(merkleRoot)
    mineNext()

    const tempAcct = (await ethers.getSigners())[0]
    const packed = addressValMap.get(tempAcct.address.toLowerCase()) || ''
    const tempAcctIdx = getAddressIndex(leaves, packed)
    expect(
      await ctx.IFFixedSale.connect(tempAcct)['checkWhitelist(address,bytes32[],uint256)'](
        tempAcct.address,
        computeMerkleProof(leaves, tempAcctIdx),
        1,
      )
    ).to.equal(true)
    expect(
      await ctx.IFFixedSale.connect(tempAcct)['checkWhitelist(address,bytes32[],uint256)'](
        tempAcct.address,
        computeMerkleProof(leaves, tempAcctIdx),
        200,
      )
    ).to.equal(false)
  })

  generalTest.prototype.it = it('can override sale token allocations (test preventing exceeding allocation)', async function () {

    const allocationAmount = 10000
    const paymentAmount = 100001
    const [leaves, addressValMap] = computeMerkleRootWithAllocation([ctx.buyer], [allocationAmount])
    // amount to pay (should fail, because this is 1 over allocation)

    // set sale token allocation override
    await ctx.IFFixedSale.connect(ctx.owner).setWhitelist(computeMerkleRoot(leaves))
    mineNext()

    // fast forward from current time to start time
    mineTimeDelta(ctx.startTime - (await getBlockTime()))

    // test purchase
    mineNext()
    await ctx.PaymentToken.connect(ctx.buyer).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )

    const packed = addressValMap.get(ctx.buyer.address.toLowerCase()) || ''
    const tempAcctIdx = getAddressIndex(leaves, packed)
    await expect(ctx.IFFixedSale.connect(ctx.buyer)['whitelistedPurchase(uint256,bytes32[],uint256)'](
      paymentAmount,
      computeMerkleProof(leaves, tempAcctIdx),
      allocationAmount,
    )).to.be.revertedWith(EXCEED_MAX_PAYMENT)

    mineNext()

    // fast forward from current time to after end time
    mineTimeDelta(ctx.endTime - (await getBlockTime()))

    // test withdraw
    mineNext()
    await expect(ctx.IFFixedSale.connect(ctx.buyer).withdraw()).to.be.revertedWith(NO_TOKEN_TO_BE_WITHDRAWN)
    mineNext()

    // expect balance to be 0
    expect(await ctx.SaleToken.balanceOf(ctx.buyer.address)).to.equal('0')
  })

  generalTest.prototype.it = it('can override sale token allocations (test multiple buyers)', async function () {
    mineNext()

    const allocationAmount = 5000
    // amount to pay for each claimer (should go through since this is exactly how much allocation they have)
    const paymentAmount = 50000

    const [leaves, addressValMap] = computeMerkleRootWithAllocation([ctx.buyer, ctx.buyer2], [allocationAmount, allocationAmount])
    await ctx.IFFixedSale.connect(ctx.owner).setWhitelist(computeMerkleRoot(leaves))
    mineNext()

    // fast forward from current time to start time
    mineTimeDelta(ctx.startTime - (await getBlockTime()))

    // test purchase for buyers 1 and 2
    mineNext()
    await ctx.PaymentToken.connect(ctx.buyer).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )
    const packed = addressValMap.get(ctx.buyer.address.toLowerCase()) || ''
    const tempAcctIdx = getAddressIndex(leaves, packed)
    await ctx.IFFixedSale.connect(ctx.buyer)['whitelistedPurchase(uint256,bytes32[],uint256)'](
      paymentAmount,
      computeMerkleProof(leaves, tempAcctIdx),
      allocationAmount,
    )

    mineNext()
    await ctx.PaymentToken.connect(ctx.buyer2).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )

    const packed2 = addressValMap.get(ctx.buyer2.address.toLowerCase()) || ''
    const tempAcctIdx2 = getAddressIndex(leaves, packed2)
    await ctx.IFFixedSale.connect(ctx.buyer2)['whitelistedPurchase(uint256,bytes32[],uint256)'](
      paymentAmount,
      computeMerkleProof(leaves, tempAcctIdx2),
      allocationAmount,
    )

    mineNext()

    // fast forward from current time to after end time
    mineTimeDelta(ctx.endTime - (await getBlockTime()))

    // test withdraw
    mineNext()
    // access control: Withdraw giveaway when sale price is not 0
    await expect(ctx.IFFixedSale.connect(ctx.buyer)['withdrawGiveaway(bytes32[],uint256)']([], allocationAmount)).to.be.revertedWith(NOT_A_GIVEAWAY)
    await ctx.IFFixedSale.connect(ctx.buyer).withdraw()
    mineNext()
    await ctx.IFFixedSale.connect(ctx.buyer2).withdraw()
    // access control: Withdraw giveaway when sale price is not 0
    await expect(ctx.IFFixedSale.connect(ctx.buyer)['withdrawGiveaway(bytes32[],uint256)']([], allocationAmount)).to.be.revertedWith(NOT_A_GIVEAWAY)
    mineNext()

    // expect balance to be 5000 for both buyers
    expect(await ctx.SaleToken.balanceOf(ctx.buyer.address)).to.equal('5000')
    expect(await ctx.SaleToken.balanceOf(ctx.buyer2.address)).to.equal('5000')

    // test purchaser counter
    expect(await ctx.IFFixedSale.purchaserCount()).to.equal(2)

    // test withdrawer counter
    expect(await ctx.IFFixedSale.withdrawerCount()).to.equal(2)
  })

  generalTest.prototype.it = it('can giveaway whitelist vested tokens', async function () {
    mineNext()

    const allocationAmount = 5000

    const [leaves, addressValMap] = computeMerkleRootWithAllocation([ctxFree.buyer, ctxFree.buyer2], [allocationAmount, allocationAmount])
    await ctxFree.IFFixedSale.connect(ctxFree.owner).setWhitelist(computeMerkleRoot(leaves))
    mineNext()
    await ctxFree.IFFixedSale.connect(ctxFree.owner).setVestedGiveaway(true)
    mineNext()

    // fast forward from current time to after end time
    mineTimeDelta(ctxFree.endTime - (await getBlockTime()))

    // test withdraw
    mineNext()
    // access control: Withdraw giveaway when sale price is not 0
    await expect(ctxFree.IFFixedSale.connect(ctxFree.buyer)['withdrawGiveaway(bytes32[],uint256)']([], allocationAmount)).to.be.revertedWith(USE_VESTED_WITHDRAW_GIVEAWAY)
    
    // test withdrawGiveawayVested
    const packed = addressValMap.get(ctxFree.buyer.address.toLowerCase()) || ''
    const tempAcctIdx = getAddressIndex(leaves, packed)
    await ctxFree.IFFixedSale.connect(ctxFree.buyer)['withdrawGiveawayVested(bytes32[],uint256)'](
      computeMerkleProof(leaves, tempAcctIdx),
      allocationAmount,
    )
    mineNext()

    // expect balance to be 5000 for both buyers
    expect(await ctxFree.SaleToken.balanceOf(ctxFree.buyer.address)).to.equal('5000')

    // test withdrawer counter
    expect(await ctxFree.IFFixedSale.withdrawerCount()).to.equal(1)
  })
  generalTest.prototype.it = it('can enable public sale', async function () {

    const allocationAmount = 10000
    const paymentAmount = 10000
    const [leaves, addressValMap] = computeMerkleRootWithAllocation([ctx.buyer], [allocationAmount])

    // set sale token allocation override
    await ctx.IFFixedSale.connect(ctx.owner).setWhitelist(computeMerkleRoot(leaves))
    await ctx.IFFixedSale.connect(ctx.owner).setPublicAllocation(allocationAmount)
    mineNext()

    // fast forward from current time to start time
    mineTimeDelta(ctx.startTime - (await getBlockTime()))

    // test purchase
    mineNext()

    await ctx.PaymentToken.connect(ctx.buyer2).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )
    mineNext()

    await ctx.IFFixedSale.connect(ctx.buyer2)['whitelistedPurchase(uint256,bytes32[],uint256)'](
      paymentAmount,
      [],
      allocationAmount,
    )
  })
  generalTest.prototype.it = it('can purchase with code and withdraw', async function () {
    const paymentAmount = 5000

    await ctx.PaymentToken.connect(ctx.buyer).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )
    mineNext()
    // 1. use the function to purchaseWithCode
    await ctx.IFFixedSale.connect(ctx.buyer).purchaseWithCode(
      paymentAmount,
      'CODE',
    )
    mineNext()

    // check variables
    expect(await ctx.IFFixedSale.paymentReceived(ctx.buyer.address)).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.paymentReceivedWithCode(ctx.buyer.address)).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.paymentReceivedWithEachCode(ctx.buyer.address, 'CODE')).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.promoCodesPerUser(ctx.buyer.address, 0)).to.equal('CODE')
    expect(await ctx.IFFixedSale.hasUsedCode(ctx.buyer.address, 'CODE')).to.equal(true)
    
    expect(await ctx.IFFixedSale.codes(0)).to.eql('CODE')
    expect(await ctx.IFFixedSale.amountPerCode('CODE')).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.uniqueUsePerCode('CODE')).to.equal(1)

    // 2. make another purchase with another code
    await ctx.PaymentToken.connect(ctx.buyer).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )
    mineNext()
    mineNext()
    // use the function to purchaseWithCode
    await ctx.IFFixedSale.connect(ctx.buyer).purchaseWithCode(
      paymentAmount,
      'CODE2',
    )
    mineNext()

    // check variables
    expect(await ctx.IFFixedSale.paymentReceived(ctx.buyer.address)).to.equal(paymentAmount * 2)
    expect(await ctx.IFFixedSale.paymentReceivedWithCode(ctx.buyer.address)).to.equal(paymentAmount * 2)
    expect(await ctx.IFFixedSale.paymentReceivedWithEachCode(ctx.buyer.address, 'CODE2')).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.promoCodesPerUser(ctx.buyer.address, 1)).to.equal('CODE2')
    expect(await ctx.IFFixedSale.hasUsedCode(ctx.buyer.address, 'CODE2')).to.equal(true)
      
    expect(await ctx.IFFixedSale.codes(1)).to.eql('CODE2')
    expect(await ctx.IFFixedSale.amountPerCode('CODE2')).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.uniqueUsePerCode('CODE2')).to.equal(1)

    // 3. make another purchase with the ctx.buyer2
    await ctx.PaymentToken.connect(ctx.buyer2).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )
    mineNext()
    // use the function to purchaseWithCode
    await ctx.IFFixedSale.connect(ctx.buyer2).purchaseWithCode(
      paymentAmount,
      'CODE2',
    )
    mineNext()

    // check variables
    expect(await ctx.IFFixedSale.paymentReceived(ctx.buyer2.address)).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.paymentReceivedWithCode(ctx.buyer2.address)).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.paymentReceivedWithEachCode(ctx.buyer2.address, 'CODE2')).to.equal(paymentAmount)
    expect(await ctx.IFFixedSale.promoCodesPerUser(ctx.buyer2.address, 0)).to.equal('CODE2')
    expect(await ctx.IFFixedSale.hasUsedCode(ctx.buyer2.address, 'CODE2')).to.equal(true)

    expect(await ctx.IFFixedSale.codes(1)).to.eql('CODE2')
    expect(await ctx.IFFixedSale.amountPerCode('CODE2')).to.equal(paymentAmount * 2)
    expect(await ctx.IFFixedSale.uniqueUsePerCode('CODE2')).to.equal(2)

    // 4. make another purchase with the ctx.buyer2 with the same code
    await ctx.PaymentToken.connect(ctx.buyer2).approve(
      ctx.IFFixedSale.address,
      paymentAmount
    )
    mineNext()
    // use the function to purchaseWithCode
    await ctx.IFFixedSale.connect(ctx.buyer2).purchaseWithCode(
      paymentAmount,
      'CODE2',
    )
    mineNext()
    
    // check variables
    expect(await ctx.IFFixedSale.paymentReceived(ctx.buyer2.address)).to.equal(paymentAmount * 2)
    expect(await ctx.IFFixedSale.paymentReceivedWithCode(ctx.buyer2.address)).to.equal(paymentAmount * 2)
    expect(await ctx.IFFixedSale.paymentReceivedWithEachCode(ctx.buyer2.address, 'CODE2')).to.equal(paymentAmount * 2)
    expect(await ctx.IFFixedSale.promoCodesPerUser(ctx.buyer2.address, 0)).to.equal('CODE2')
    expect(await ctx.IFFixedSale.hasUsedCode(ctx.buyer2.address, 'CODE2')).to.equal(true)
    
    expect(await ctx.IFFixedSale.codes(1)).to.eql('CODE2')
    expect(await ctx.IFFixedSale.amountPerCode('CODE2')).to.equal(paymentAmount * 3)
    expect(await ctx.IFFixedSale.uniqueUsePerCode('CODE2')).to.equal(2)

    // withdraw
    // fast forward from current time to after end time
    mineTimeDelta(ctx.endTime - (await getBlockTime()))
    await ctx.IFFixedSale.connect(ctx.buyer).withdraw()
    mineNext()
    await ctx.IFFixedSale.connect(ctx.buyer2).withdraw()
    mineNext()

    // expect balance to be 5000 for both buyers
    expect(await ctx.SaleToken.balanceOf(ctx.buyer.address)).to.equal(paymentAmount * 2 / 10)
    expect(await ctx.SaleToken.balanceOf(ctx.buyer2.address)).to.equal(paymentAmount * 2 / 10)
  })
  generalTest.prototype.it = it('whitelist setter can setMaxTotalPurchasable', async function () {

    await ctx.IFFixedSale.connect(ctx.owner).setMaxTotalPurchasable(10)
    await ctx.IFFixedSale.connect(ctx.owner).setWhitelistSetter(ctx.buyer.address)
    await ctx.IFFixedSale.connect(ctx.buyer).setMaxTotalPurchasable(10)
    mineNext()

    await expect(ctx.IFFixedSale.connect(ctx.buyer2).setMaxTotalPurchasable(10)).to.be.revertedWith(NOT_WHITELIST_SETTER_OR_OWNER)
  })
})