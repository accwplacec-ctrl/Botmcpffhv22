// garden.js
const Vec3 = require('vec3');

/**
 * Kiểm tra vị trí có nằm trong khu vườn không
 * @param {Object} position - Vị trí cần kiểm tra {x, y, z}
 * @param {Object} center - Tâm khu vườn {x, z}
 * @param {number} radius - Bán kính khu vườn
 * @returns {boolean}
 */
function isInGarden(position, center, radius) {
    if (!position || !center) return false;

    const dx = position.x - center.x;
    const dz = position.z - center.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist <= radius;
}

/**
 * Lấy vị trí ngẫu nhiên trong vườn
 * @param {Object} center - Tâm khu vườn {x, z}
 * @param {number} radius - Bán kính khu vườn
 * @returns {Object} {x, z}
 */
function getRandomGardenPosition(center, radius) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * radius * 0.8; // 80% của radius để không ra ngoài
    return {
        x: center.x + Math.cos(angle) * dist,
        z: center.z + Math.sin(angle) * dist
    };
}

/**
 * Tìm block farmland gần nhất trong vườn
 * @param {Object} bot - Bot instance
 * @param {Object} center - Tâm khu vườn {x, z}
 * @param {number} radius - Bán kính tìm kiếm
 * @returns {Object|null} Vị trí block farmland hoặc null
 */
function getClosestFarmland(bot, center, radius) {
    if (!bot) return null;

    try {
        const blocks = bot.findBlocks({
            matching: ['farmland'],
            maxDistance: radius,
            count: 20
        });

        if (!blocks || blocks.length === 0) return null;

        // Sắp xếp theo khoảng cách
        const sorted = blocks.map(pos => {
            const dist = bot.entity.position.distanceTo(pos);
            return { pos, dist };
        }).sort((a, b) => a.dist - b.dist);

        return sorted[0].pos;
    } catch (error) {
        console.error('[Garden] Error finding farmland:', error);
        return null;
    }
}

/**
 * Đếm số cây lúa trong khu vực
 * @param {Object} bot - Bot instance
 * @param {number} radius - Bán kính tìm kiếm
 * @returns {number}
 */
function countWheatAround(bot, radius = 5) {
    if (!bot) return 0;

    try {
        const blocks = bot.findBlocks({
            matching: ['wheat'],
            maxDistance: radius,
            count: 50
        });
        return blocks ? blocks.length : 0;
    } catch (error) {
        console.error('[Garden] Error counting wheat:', error);
        return 0;
    }
}

/**
 * Đếm số cây lúa chín trong khu vực
 * @param {Object} bot - Bot instance
 * @param {number} radius - Bán kính tìm kiếm
 * @returns {number}
 */
function countReadyWheat(bot, radius = 5) {
    if (!bot) return 0;

    try {
        const blocks = bot.findBlocks({
            matching: ['wheat'],
            maxDistance: radius,
            count: 50
        });

        if (!blocks) return 0;

        let ready = 0;
        for (const pos of blocks) {
            const block = bot.blockAt(pos);
            if (block && block.metadata === 7) {
                ready++;
            }
        }
        return ready;
    } catch (error) {
        console.error('[Garden] Error counting ready wheat:', error);
        return 0;
    }
}

/**
 * Tìm vị trí đất trống để trồng lúa
 * @param {Object} bot - Bot instance
 * @param {number} radius - Bán kính tìm kiếm
 * @returns {Object|null} Vị trí đất trống hoặc null
 */
function findPlantingSpot(bot, radius = 5) {
    if (!bot) return null;

    try {
        const farmlandBlocks = bot.findBlocks({
            matching: ['farmland'],
            maxDistance: radius,
            count: 20
        });

        if (!farmlandBlocks || farmlandBlocks.length === 0) return null;

        for (const pos of farmlandBlocks) {
            const above = bot.blockAt({ x: pos.x, y: pos.y + 1, z: pos.z });
            if (above && above.name === 'air') {
                return pos;
            }
        }
        return null;
    } catch (error) {
        console.error('[Garden] Error finding planting spot:', error);
        return null;
    }
}

/**
 * Kiểm tra xem lúa đã chín chưa
 * @param {Object} bot - Bot instance
 * @param {Object} position - Vị trí cây lúa
 * @returns {boolean}
 */
function isWheatReady(bot, position) {
    if (!bot || !position) return false;

    try {
        const block = bot.blockAt(position);
        if (!block || block.name !== 'wheat') return false;
        return block.metadata === 7;
    } catch (error) {
        console.error('[Garden] Error checking wheat ready:', error);
        return false;
    }
}

/**
 * Tìm cây lúa chín gần nhất
 * @param {Object} bot - Bot instance
 * @param {number} radius - Bán kính tìm kiếm
 * @returns {Object|null} Vị trí cây lúa chín hoặc null
 */
function findReadyWheat(bot, radius = 5) {
    if (!bot) return null;

    try {
        const blocks = bot.findBlocks({
            matching: ['wheat'],
            maxDistance: radius,
            count: 20
        });

        if (!blocks || blocks.length === 0) return null;

        for (const pos of blocks) {
            const block = bot.blockAt(pos);
            if (block && block.metadata === 7) {
                return pos;
            }
        }
        return null;
    } catch (error) {
        console.error('[Garden] Error finding ready wheat:', error);
        return null;
    }
}

/**
 * Tính khoảng cách từ vị trí đến tâm vườn
 * @param {Object} position - Vị trí cần tính {x, y, z}
 * @param {Object} center - Tâm vườn {x, z}
 * @returns {number}
 */
function distanceToGardenCenter(position, center) {
    if (!position || !center) return Infinity;
    const dx = position.x - center.x;
    const dz = position.z - center.z;
    return Math.sqrt(dx * dx + dz * dz);
}

module.exports = {
    isInGarden,
    getRandomGardenPosition,
    getClosestFarmland,
    countWheatAround,
    countReadyWheat,
    findPlantingSpot,
    isWheatReady,
    findReadyWheat,
    distanceToGardenCenter
};
