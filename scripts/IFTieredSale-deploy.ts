// We require the Hardhat Runtime Environment explicitly here. This is optional 
// but useful for running the script in a standalone fashion through node <script>.
//
// When running the script with hardhat run <script> you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre from 'hardhat'

export async function main(): Promise<void> {

    // get deployer
    const [deployer] = await hre.ethers.getSigners()
    const balance = await deployer.getBalance()
    console.log('Deploying contracts with account: ', deployer.address)
    console.log('Account balance: ', hre.ethers.utils.formatEther(balance))

    // deploy params
    const payToken: string = process.env.PAY_TOKEN || '' // address
    const saleToken: string = process.env.SALE_TOKEN || '' // address
    const startBlock: number = parseInt(process.env.START_BLOCK || '') // start block of sale (inclusive)
    const endBlock: number = parseInt(process.env.END_BLOCK || '') // end block of sale (inclusive)

    // We get the contract to deploy
    const IFTieredSaleFactory = await hre.ethers.getContractFactory('IFTieredSaleV2')
    console.log(IFTieredSaleFactory.bytecode)

    // deploy
    const IFTieredSale = await IFTieredSaleFactory.deploy(
        payToken,
        saleToken,
        startBlock,
        endBlock,
    )

    await IFTieredSale.deployed()

    console.log('IFTieredSale deployed to ', IFTieredSale.address)

    // verify contract
    await hre.run('verify:verify', {
        address: IFTieredSale.address,
        constructorArguments: [
            payToken,
            saleToken,
            startBlock,
            endBlock,
        ],
    })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    })