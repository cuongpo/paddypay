// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/PaddyRegistry.sol";
import "../src/MockPayToken.sol";

contract PaddyRegistryTest is Test {
    PaddyRegistry registry;
    MockPayToken token;
    bytes32 plotId = keccak256("A-01");
    bytes32 seasonId = 0xbca67bebd45ad8fbc72cfe42154746312ad6352ee7f169bcf5ff5fe11d8ccb4b;
    bytes32 cluster = keccak256("A");
    address farmer = address(0xBEEF);
    address coop = address(0xCAFE);
    address developer = address(0xD00D);
    uint256 devicePk = 0xA11CE;
    address device;
    function setUp() public {
        token = new MockPayToken();
        registry = new PaddyRegistry(address(token),coop,developer,7000,1000,2000);
        device = vm.addr(devicePk);
        vm.prank(coop);
        registry.registerDevice(cluster,device);
        registry.registerPlot(plotId,seasonId,cluster,keccak256("polygon"),farmer);
    }
    function testDuplicatePlotAndBatchRevert() public {
        vm.expectRevert(PaddyRegistry.PlotAlreadyClaimed.selector);
        registry.registerPlot(plotId,seasonId,cluster,keccak256("polygon"),farmer);
        registry.anchorBatch(plotId,seasonId,32,keccak256("root"),1);
        vm.expectRevert(PaddyRegistry.BatchAlreadyAnchored.selector);
        registry.anchorBatch(plotId,seasonId,32,keccak256("other"),1);
    }
    function testOnlyCoopCanRegisterDevice() public {
        vm.expectRevert(PaddyRegistry.Unauthorized.selector);
        registry.registerDevice(cluster,address(0x1234));
        vm.prank(address(0x1234));
        vm.expectRevert(PaddyRegistry.Unauthorized.selector);
        registry.registerDevice(cluster,address(0x1234));
    }
    function testCannotAnchorWithoutClusterDevice() public {
        bytes32 otherPlot=keccak256("D-01");
        registry.registerPlot(otherPlot,seasonId,keccak256("D"),keccak256("polygon"),farmer);
        vm.expectRevert(PaddyRegistry.InvalidBatch.selector);
        registry.anchorBatch(otherPlot,seasonId,1,keccak256("root"),1);
    }
    function testSignedReadingAndTamper() public {
        uint64 ts=1767225600;
        int32 water=-12;
        uint64 seq=94;
        bytes32 digest=keccak256(abi.encode(device,plotId,seasonId,ts,water,seq));
        bytes32 ethHash=keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",digest));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(devicePk,ethHash);
        bytes memory signature=abi.encodePacked(r,s,v);
        bytes32 leaf=keccak256(abi.encodePacked(digest,signature));
        registry.anchorBatch(plotId,seasonId,32,leaf,1);
        bytes32[] memory proof=new bytes32[](0);
        assertTrue(registry.verifyReading(plotId,seasonId,32,ts,water,seq,device,signature,proof));
        assertFalse(registry.verifyReading(plotId,seasonId,32,ts,water+1,seq,device,signature,proof));
        assertFalse(registry.verifyReading(plotId,seasonId,32,ts,water,seq,address(0x1234),signature,proof));
    }
    function testEligiblePayoutAndDoubleWithdrawal() public {
        vm.expectRevert(PaddyRegistry.NotEligible.selector);
        registry.finalizePlot(plotId,seasonId,1895,farmer);
        registry.setEligible(plotId,seasonId,true);
        registry.finalizePlot(plotId,seasonId,1895,farmer);
        token.mint(address(this),1001);
        token.approve(address(registry),1001);
        registry.allocateSale(plotId,seasonId,1001);
        vm.expectRevert(PaddyRegistry.AlreadyAllocated.selector);
        registry.allocateSale(plotId,seasonId,1001);
        assertEq(registry.claimable(farmer),700);
        assertEq(registry.claimable(coop),101);
        assertEq(registry.claimable(developer),200);
        assertEq(registry.claimable(farmer)+registry.claimable(coop)+registry.claimable(developer),1001);
        vm.prank(farmer);
        registry.withdraw();
        assertEq(token.balanceOf(farmer),700);
        vm.prank(farmer);
        vm.expectRevert(PaddyRegistry.NothingToWithdraw.selector);
        registry.withdraw();
    }
    function testCannotAllocateBeforeFinalization() public {
        vm.expectRevert(PaddyRegistry.NotEligible.selector);
        registry.allocateSale(plotId,seasonId,100);
    }
}
