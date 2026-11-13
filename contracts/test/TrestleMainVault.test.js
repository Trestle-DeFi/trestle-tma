const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrestleMainVault", function () {
  let mainVault, owner, addr1;
  
  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const TrestleMainVault = await ethers.getContractFactory("TrestleMainVault");
    mainVault = await TrestleMainVault.deploy();
    await mainVault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await mainVault.owner()).to.equal(owner.address);
    });
  });

  describe("requestTopUp", function () {
    let requestId;

    it("Should create a top-up request", async function () {
      const subAccount = ethers.Wallet.createRandom().address;
      const amount = ethers.parseEther("0.01");
      
      const tx = await mainVault.connect(owner).requestTopUp(subAccount, amount);
      const receipt = await tx.wait();
      
      // Get requestId from TopUpRequested event
      const event = receipt.logs.find(log => {
        try {
          const parsed = mainVault.interface.parseLog(log);
          return parsed.name === "TopUpRequested";
        } catch { return false; }
      });
      
      expect(event).to.not.be.undefined;
      requestId = mainVault.interface.parseLog(event.log).args.requestId;
    });

    it("Should revert when amount is too small", async function () {
      const subAccount = ethers.Wallet.createRandom().address;
      const amount = ethers.parseEther("0.000001");
      
      await expect(
        mainVault.connect(owner).requestTopUp(subAccount, amount)
      ).to.be.revertedWith("Amount too small");
    });
  });

  describe("releaseTopup", function () {
    let requestId;
    const subAccount = ethers.Wallet.createRandom().address;
    const amount = ethers.parseEther("0.01");

    beforeEach(async function () {
      const tx = await mainVault.connect(owner).requestTopUp(subAccount, amount);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = mainVault.interface.parseLog(log);
          return parsed.name === "TopUpRequested";
        } catch { return false; }
      });
      requestId = mainVault.interface.parseLog(event.log).args.requestId;
    });

    it("Should release top-up to sub-account", async function () {
      await mainVault.connect(owner).setReactiveContract(addr1.address);
      const tx = await mainVault.connect(addr1).releaseTopup(requestId, subAccount, amount);
      await expect(tx).to.emit(mainVault, "TopUpReleased");
    });

    it("Should revert when called by non-reactive contract", async function () {
      await expect(
        mainVault.connect(owner).releaseTopup(requestId, subAccount, amount)
      ).to.be.revertedWith("Not reactive contract");
    });
  });
});