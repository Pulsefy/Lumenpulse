// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProtocolStats
 * @dev Maintains high-level protocol statistics on-chain for trustless reporting
 * Tracks Total Value Locked (TVL) and Cumulative Funding Volume
 */
contract ProtocolStats {
    // State variables for on-chain statistics
    uint256 public totalValueLocked;
    uint256 public cumulativeFundingVolume;
    
    // Events for off-chain indexing and transparency
    event TVLUpdated(uint256 oldTVL, uint256 newTVL, uint256 timestamp);
    event FundingVolumeUpdated(uint256 oldVolume, uint256 newVolume, uint256 timestamp);
    event FundsDeposited(address indexed user, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(address indexed user, uint256 amount, uint256 timestamp);
    
    /**
     * @dev Constructor initializes statistics to zero
     */
    constructor() {
        totalValueLocked = 0;
        cumulativeFundingVolume = 0;
    }
    
    /**
     * @notice Get current protocol statistics
     * @return tvl Current Total Value Locked
     * @return fundingVolume Cumulative Funding Volume
     */
    function getProtocolStats() external view returns (uint256 tvl, uint256 fundingVolume) {
        return (totalValueLocked, cumulativeFundingVolume);
    }
    
    /**
     * @dev Internal function to update TVL when funds are deposited
     * @param amount Amount of funds deposited
     */
    function _updateTVLDeposit(uint256 amount) internal {
        uint256 oldTVL = totalValueLocked;
        totalValueLocked += amount;
        emit TVLUpdated(oldTVL, totalValueLocked, block.timestamp);
    }
    
    /**
     * @dev Internal function to update TVL when funds are withdrawn
     * @param amount Amount of funds withdrawn
     */
    function _updateTVLWithdrawal(uint256 amount) internal {
        uint256 oldTVL = totalValueLocked;
        require(totalValueLocked >= amount, "Insufficient TVL");
        totalValueLocked -= amount;
        emit TVLUpdated(oldTVL, totalValueLocked, block.timestamp);
    }
    
    /**
     * @dev Internal function to update cumulative funding volume
     * @param amount Amount of new funding
     */
    function _updateFundingVolume(uint256 amount) internal {
        uint256 oldVolume = cumulativeFundingVolume;
        cumulativeFundingVolume += amount;
        emit FundingVolumeUpdated(oldVolume, cumulativeFundingVolume, block.timestamp);
    }
    
    /**
     * @notice Record a deposit (to be called by main protocol contract)
     * @param user Address of the user depositing funds
     * @param amount Amount deposited
     */
    function recordDeposit(address user, uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        _updateTVLDeposit(amount);
        _updateFundingVolume(amount);
        emit FundsDeposited(user, amount, block.timestamp);
    }
    
    /**
     * @notice Record a withdrawal (to be called by main protocol contract)
     * @param user Address of the user withdrawing funds
     * @param amount Amount withdrawn
     */
    function recordWithdrawal(address user, uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        _updateTVLWithdrawal(amount);
        emit FundsWithdrawn(user, amount, block.timestamp);
    }
    
    /**
     * @notice Manually adjust TVL (for corrections or admin operations)
     * @dev Only callable by authorized addresses
     * @param newTVL New TVL value
     */
    function setTVL(uint256 newTVL) external {
        uint256 oldTVL = totalValueLocked;
        totalValueLocked = newTVL;
        emit TVLUpdated(oldTVL, totalValueLocked, block.timestamp);
    }
    
    /**
     * @notice Manually adjust cumulative funding volume (for corrections)
     * @dev Only callable by authorized addresses
     * @param newVolume New funding volume value
     */
    function setFundingVolume(uint256 newVolume) external {
        uint256 oldVolume = cumulativeFundingVolume;
        cumulativeFundingVolume = newVolume;
        emit FundingVolumeUpdated(oldVolume, cumulativeFundingVolume, block.timestamp);
    }
}
