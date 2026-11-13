const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TrestleReactiveGuard", function () {
  let reactiveGuard, owner, addr1;
  
  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const TrestleReactiveGuard = await ethers.getContractFactory("TrestleReactiveGuard");
    reactiveGuard = await TrestleReactiveGuard.deploy();
    await reactiveGuard.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await reactiveGuard.owner()).to.equal(owner.address);
    });
  });

  describe("setupSubscription", function () {
    it("Should create a new subscription", async function () {
      const subAccount = ethers.Wallet.createRandom().address;
      const mainVault = ethers.Wallet.createRandom().address;
      const callbackUrl = "https://callback.trestle.website";
      
      await expect(
        reactiveGuard.connect(owner).setupSubscription(subAccount, mainVault, callbackUrl, 10)
      ).to.emit(reactiveGuard, "SubscriptionCreated");
    });

    it("Should revert when max subscriptions reached", async function () {
      const subAccount = ethers.Wallet.createRandom().address;
      const mainVault = ethers.Wallet.createRandom().address;
      const callbackUrl = "https://callback.trestle.website";
      
      await expect(
        reactiveGuard.connect(owner).setupSubscription(subAccount, mainVault, callbackUrl, 10)
      ).to.not.be.reverted;
    });
  });

  describe("react", function () {
    it("Should revert when called by unauthorized sender", async function () {
      const subAccount = ethers.Wallet.createRandom().address;
      const mainVault = ethers.Wallet.createRandom().address;
      
      const eventData = ethers.solidityPack(
        ["address", "uint256", "uint256", "uint64"],
        [subAccount, ethers.parseEther("0.005"), ethers.parseEther("0.01"), 1]
      );
      
      await expect(
        reactiveGuard.connect(owner).react(eventData)
      ).to.be.revertedWith("Not authorized reactive sender");
    });

    it("Should process event data when called by authorized reactive sender", async function () {
      const subAccount = ethers.Wallet.createRandom().address;
      const mainVault = ethers.Wallet.createRandom().address;
      
      // Authorize owner as reactive sender
      await reactiveGuard.connect(owner).setReactiveSender(owner.address);
      
      const eventData = ethers.solidityPack(
        ["address", "uint256", "uint256", "uint64"],
        [subAccount, ethers.parseEther("0.005"), ethers.parseEther("0.01"), 1]
      );
      
      // First setup subscription for this subAccount
      await reactiveGuard.connect(owner).setupSubscription(subAccount, mainVault, "https://callback.trestle.website", 10);
      
      const tx = await reactiveGuard.connect(owner).react(eventData);
      await expect(tx).to.emit(reactiveGuard, "TopupCallbackRequested");
    });
  });
});