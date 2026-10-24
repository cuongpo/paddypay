// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Pay {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract PaddyRegistry {
    error Unauthorized();
    error PlotAlreadyClaimed();
    error UnknownPlot();
    error BatchAlreadyAnchored();
    error InvalidBatch();
    error NotEligible();
    error AlreadyFinalized();
    error AlreadyAllocated();
    error NothingToWithdraw();
    error TransferFailed();
    error BadShares();
    error Reentrant();

    struct Plot {
        bytes32 cluster;
        bytes32 polygonHash;
        address farmer;
        uint64 tCO2eMilli;
        bool exists;
        bool eligible;
        bool finalized;
        bool saleAllocated;
    }
    struct BatchInput {
        bytes32 plotId;
        bytes32 seasonId;
        uint32 day;
        bytes32 root;
        uint32 count;
    }
    struct PhotoInput {
        bytes32 plotId;
        bytes32 seasonId;
        bytes32 evidenceId;
        bytes32 imageHash;
    }
    address public owner;
    address public coop;
    address public developer;
    IERC20Pay public immutable token;
    uint16 public immutable farmerBps;
    uint16 public immutable coopBps;
    uint16 public immutable developerBps;
    bool private entered;

    mapping(bytes32 => Plot) public plots;
    mapping(bytes32 => address) public devices;
    mapping(bytes32 => bytes32) public roots;
    mapping(bytes32 => uint32) public batchCounts;
    mapping(bytes32 => bytes32) public photoHashes;
    mapping(address => uint256) public claimable;

    event PlotRegistered(bytes32 indexed plotKey, bytes32 indexed plotId, bytes32 indexed seasonId, bytes32 cluster);
    event DeviceRegistered(bytes32 indexed cluster, address indexed device);
    event BatchAnchored(bytes32 indexed plotKey, uint32 indexed day, bytes32 root, uint32 count);
    event PhotoRecorded(bytes32 indexed plotKey, bytes32 indexed evidenceId, bytes32 imageHash);
    event PlotFinalized(bytes32 indexed plotKey, uint64 tCO2eMilli, address indexed farmer);
    event SaleAllocated(bytes32 indexed plotKey, uint256 amount, uint256 farmerAmount, uint256 coopAmount, uint256 developerAmount);
    event Withdrawn(address indexed recipient, uint256 amount);

    constructor(address token_, address coop_, address developer_, uint16 farmer_, uint16 coopShare_, uint16 developerShare_) {
        if (farmer_ + coopShare_ + developerShare_ != 10000) revert BadShares();
        owner = msg.sender;
        coop = coop_;
        developer = developer_;
        token = IERC20Pay(token_);
        farmerBps = farmer_;
        coopBps = coopShare_;
        developerBps = developerShare_;
    }
    modifier onlyOperator() {
        if (msg.sender != owner && msg.sender != coop) revert Unauthorized();
        _;
    }
    modifier onlyCoop() {
        if (msg.sender != coop) revert Unauthorized();
        _;
    }
    function key(bytes32 plotId, bytes32 seasonId) public pure returns (bytes32) {
        return keccak256(abi.encode(plotId, seasonId));
    }
    function batchKey(bytes32 plotId, bytes32 seasonId, uint32 day) public pure returns (bytes32) {
        return keccak256(abi.encode(plotId, seasonId, day));
    }
    function registerPlot(bytes32 plotId, bytes32 seasonId, bytes32 cluster, bytes32 polygonHash, address farmer) external onlyOperator {
        bytes32 k = key(plotId, seasonId);
        if (plots[k].exists) revert PlotAlreadyClaimed();
        plots[k] = Plot(cluster, polygonHash, farmer, 0, true, false, false, false);
        emit PlotRegistered(k, plotId, seasonId, cluster);
    }
    function registerDevice(bytes32 cluster, address device) external onlyCoop {
        devices[cluster] = device;
        emit DeviceRegistered(cluster, device);
    }
    function anchorBatch(bytes32 plotId, bytes32 seasonId, uint32 day, bytes32 root, uint32 count) public onlyOperator {
        bytes32 k = key(plotId, seasonId);
        if (!plots[k].exists) revert UnknownPlot();
        if (devices[plots[k].cluster] == address(0)) revert InvalidBatch();
        bytes32 b = batchKey(plotId, seasonId, day);
        if (roots[b] != bytes32(0)) revert BatchAlreadyAnchored();
        if (root == bytes32(0) || count == 0) revert InvalidBatch();
        roots[b] = root;
        batchCounts[b] = count;
        emit BatchAnchored(k, day, root, count);
    }
    function anchorBatches(BatchInput[] calldata batches) external onlyOperator {
        for (uint256 i; i < batches.length; ++i) {
            BatchInput calldata b = batches[i];
            anchorBatch(b.plotId, b.seasonId, b.day, b.root, b.count);
        }
    }
    function recordPhoto(bytes32 plotId, bytes32 seasonId, bytes32 evidenceId, bytes32 imageHash) external onlyOperator {
        bytes32 k = key(plotId, seasonId);
        if (!plots[k].exists) revert UnknownPlot();
        photoHashes[keccak256(abi.encode(k, evidenceId))] = imageHash;
        emit PhotoRecorded(k, evidenceId, imageHash);
    }
    function recordPhotos(PhotoInput[] calldata photos) external onlyOperator {
        for (uint256 i; i < photos.length; ++i) {
            PhotoInput calldata p = photos[i];
            bytes32 k = key(p.plotId, p.seasonId);
            if (!plots[k].exists) revert UnknownPlot();
            photoHashes[keccak256(abi.encode(k, p.evidenceId))] = p.imageHash;
            emit PhotoRecorded(k, p.evidenceId, p.imageHash);
        }
    }
    function setEligible(bytes32 plotId, bytes32 seasonId, bool eligible) external onlyOperator {
        bytes32 k = key(plotId, seasonId);
        if (!plots[k].exists) revert UnknownPlot();
        if (plots[k].finalized) revert AlreadyFinalized();
        plots[k].eligible = eligible;
    }
    function finalizePlot(bytes32 plotId, bytes32 seasonId, uint64 tCO2eMilli, address farmer) external onlyOperator {
        Plot storage p = plots[key(plotId, seasonId)];
        if (!p.exists) revert UnknownPlot();
        if (!p.eligible) revert NotEligible();
        if (p.finalized) revert AlreadyFinalized();
        if (farmer != p.farmer || farmer == address(0) || tCO2eMilli == 0) revert InvalidBatch();
        p.tCO2eMilli = tCO2eMilli;
        p.finalized = true;
        emit PlotFinalized(key(plotId, seasonId), tCO2eMilli, farmer);
    }
    function allocateSale(bytes32 plotId, bytes32 seasonId, uint256 amount) external {
        bytes32 k = key(plotId, seasonId);
        Plot storage p = plots[k];
        if (!p.finalized) revert NotEligible();
        if (p.saleAllocated) revert AlreadyAllocated();
        if (amount == 0) revert InvalidBatch();
        p.saleAllocated = true;
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 farmerAmount = amount * farmerBps / 10000;
        uint256 developerAmount = amount * developerBps / 10000;
        uint256 coopAmount = amount - farmerAmount - developerAmount;
        claimable[p.farmer] += farmerAmount;
        claimable[coop] += coopAmount;
        claimable[developer] += developerAmount;
        emit SaleAllocated(k, amount, farmerAmount, coopAmount, developerAmount);
    }
    function withdraw() external {
        if (entered) revert Reentrant();
        entered = true;
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
        entered = false;
        emit Withdrawn(msg.sender, amount);
    }
    function verifyReading(
        bytes32 plotId, bytes32 seasonId, uint32 day, uint64 ts, int32 waterLevelCm, uint64 seq,
        address device, bytes calldata signature, bytes32[] calldata proof
    ) external view returns (bool) {
        Plot storage p = plots[key(plotId, seasonId)];
        if (!p.exists || devices[p.cluster] != device) return false;
        bytes32 root = roots[batchKey(plotId, seasonId, day)];
        if (root == bytes32(0) || signature.length != 65) return false;
        bytes32 digest = keccak256(abi.encode(device, plotId, seasonId, ts, waterLevelCm, seq));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (ecrecover(ethHash, v, r, s) != device) return false;
        bytes32 leaf = keccak256(abi.encodePacked(digest, signature));
        for (uint256 i; i < proof.length; ++i) {
            bytes32 sibling = proof[i];
            leaf = leaf < sibling ? keccak256(abi.encodePacked(leaf, sibling)) : keccak256(abi.encodePacked(sibling, leaf));
        }
        return leaf == root;
    }
}
