const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrestleSubAccount", function () {
  let subAccount, owner, addr1;
  
  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const TrestleSubAccount = await ethers.getContractFactory("TrestleSubAccount");
    subAccount = await TrestleSubAccount.deploy();
    await subAccount.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await subAccount.owner()).to.equal(owner.address);
    });
  });

  describe("createSubAccount", function () {
    it("Should create a new sub-account", async function () {
      const mainVault = ethers.ZeroAddress;
      const threshold = ethers.parseEther("0.005");
      const target = ethers.parseEther("0.01");
      const cooldown = 300;
      const maxDaily = 10;
      
      await expect(
        subAccount.connect(owner).createSubAccount(mainVault, threshold, target, cooldown, maxDaily)
      ).to.emit(subAccount, "SubAccountCreated");
      
      const info = await subAccount.getSubAccountInfo(owner.address);
      expect(info.mainVault).to.equal(mainVault);
      expect(info.threshold).to.equal(threshold);
      expect(info.target).to.equal(target);
      expect(info.isActive).to.equal(true);
    });

    it("Should revert when threshold is too low", async function () {
      await expect(
        subAccount.connect(owner).createSubAccount(
          ethers.ZeroAddress,
          ethers.parseEther("0.000001"),
          ethers.parseEther("0.01"),
          300,
          100
        )
      ).to.be.revertedWith("Threshold too low");
    });
  });

  describe("spend", function () {
    beforeEach(async function () {
      await subAccount.connect(owner).createSubAccount(
        ethers.ZeroAddress,
        ethers.parseEther("0.005"),
        ethers.parseEther("0.01"),
        300,
        100
      );
    });

    it("Should emit LowBalanceDetected when balance below threshold", async function () {
      const amount = ethers.parseEther("0.008");
      const recipient = ethers.Wallet.createRandom().address;
      
      const tx = await subAccount.connect(owner).spend(recipient, amount, ethers.ZeroAddress);
      await expect(tx)
        .to.emit(subAccount, "LowBalanceDetected")
        .withArgs(owner.address, amount, amount, 1);
    });
  });
});