const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Minimal Test", function () {
  it("should pass", async function () {
    expect(true).to.be.true;
  });

  it("should parse ether", async function () {
    const amount = ethers.parseEther("1");
    expect(amount).to.equal(1000000000000000000n);
  });

  it("should create contract and check owner", async function () {
    const TrestleSubAccount = await ethers.getContractFactory("TrestleSubAccount");
    const instance = await TrestleSubAccount.deploy();
    await instance.waitForDeployment();
    const owner = await ethers.getSigners();
    expect(await instance.owner()).to.equal(owner[0].address);
  });
});