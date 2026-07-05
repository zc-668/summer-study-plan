const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'summer-study-plan-secret-key-2024';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化SQLite数据库
const db = new sqlite3.Database(path.join(dataDir, 'studyplan.db'));

db.serialize(() => {
    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student', 'parent')),
        parent_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 家长绑定表
    db.run(`CREATE TABLE IF NOT EXISTS parent_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_code TEXT NOT NULL,
        student_id INTEGER NOT NULL,
        parent_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_code, parent_id)
    )`);

    // 周计划模板表（手动制定的计划）
    db.run(`CREATE TABLE IF NOT EXISTS weekly_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        week_start TEXT NOT NULL,
        date TEXT NOT NULL,
        slot TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        subject TEXT,
        content TEXT,
        duration INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, week_start, date, slot, slot_index)
    )`);

    // 每日任务表（确认后的执行任务）
    db.run(`CREATE TABLE IF NOT EXISTS daily_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        subject TEXT NOT NULL,
        slot TEXT NOT NULL,
        content TEXT NOT NULL,
        duration INTEGER DEFAULT 60,
        priority TEXT DEFAULT 'medium',
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        from_plan INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 自定义任务表（今日视图添加的额外任务）
    db.run(`CREATE TABLE IF NOT EXISTS custom_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        subject TEXT NOT NULL,
        slot TEXT NOT NULL,
        content TEXT NOT NULL,
        duration INTEGER DEFAULT 60,
        priority TEXT DEFAULT 'medium',
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// JWT验证中间件
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: '未提供认证令牌' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: '令牌无效或已过期' });
        }
        req.user = user;
        next();
    });
};

// ==================== 认证API ====================

// 注册
app.post('/api/auth/register', async (req, res) => {
    const { username, password, displayName, role, parentCode } = req.body;

    if (!username || !password || !displayName || !role) {
        return res.status(400).json({ success: false, message: '请填写所有必填字段' });
    }

    try {
        // 检查用户名是否已存在
        const existingUser = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (existingUser) {
            return res.status(400).json({ success: false, message: '用户名已存在' });
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 生成家长绑定码（学生角色）
        let generatedParentCode = null;
        if (role === 'student') {
            generatedParentCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        }

        // 插入用户
        const result = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO users (username, password, display_name, role, parent_code) VALUES (?, ?, ?, ?, ?)',
                [username, hashedPassword, displayName, role, generatedParentCode],
                function(err) {
                    if (err) reject(err);
                    resolve({ id: this.lastID });
                }
            );
        });

        // 如果是家长注册，尝试绑定学生
        if (role === 'parent' && parentCode) {
            const student = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE parent_code = ? AND role = "student"', [parentCode], (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                });
            });

            if (student) {
                await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT OR IGNORE INTO parent_bindings (parent_code, student_id, parent_id) VALUES (?, ?, ?)',
                        [parentCode, student.id, result.id],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });
            }
        }

        // 生成JWT令牌
        const token = jwt.sign(
            { id: result.id, username, role, displayName },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: result.id,
                username,
                displayName,
                role,
                parentCode: generatedParentCode
            }
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: '请填写用户名和密码' });
    }

    try {
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (!user) {
            return res.status(400).json({ success: false, message: '用户名或密码错误' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ success: false, message: '用户名或密码错误' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, displayName: user.display_name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                role: user.role,
                parentCode: user.parent_code
            }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 获取当前用户信息
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT id, username, display_name, role, parent_code FROM users WHERE id = ?', [req.user.id], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                role: user.role,
                parentCode: user.parent_code
            }
        });
    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 家长绑定API ====================

// 家长绑定学生
app.post('/api/parent/bind', authenticateToken, async (req, res) => {
    const { parentCode } = req.body;

    if (req.user.role !== 'parent') {
        return res.status(403).json({ success: false, message: '只有家长角色可以绑定学生' });
    }

    try {
        const student = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE parent_code = ? AND role = "student"', [parentCode], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (!student) {
            return res.status(400).json({ success: false, message: '绑定码无效' });
        }

        await new Promise((resolve, reject) => {
            db.run(
                'INSERT OR IGNORE INTO parent_bindings (parent_code, student_id, parent_id) VALUES (?, ?, ?)',
                [parentCode, student.id, req.user.id],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        res.json({ success: true, studentId: student.id });
    } catch (error) {
        console.error('绑定错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 获取家长绑定的学生列表
app.get('/api/parent/children', authenticateToken, async (req, res) => {
    if (req.user.role !== 'parent') {
        return res.status(403).json({ success: false, message: '只有家长角色可以查看学生' });
    }

    try {
        const children = await new Promise((resolve, reject) => {
            db.all(
                `SELECT DISTINCT u.id, u.username, u.display_name, u.parent_code
                 FROM users u
                 JOIN parent_bindings pb ON u.id = pb.student_id
                 WHERE pb.parent_id = ? AND u.role = "student"`,
                [req.user.id],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        res.json({
            success: true,
            children: children.map(c => ({
                id: c.id,
                username: c.username,
                displayName: c.display_name,
                parentCode: c.parent_code
            }))
        });
    } catch (error) {
        console.error('获取学生列表错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 获取学生绑定的家长列表
app.get('/api/student/parents', authenticateToken, async (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ success: false, message: '只有学生角色可以查看家长' });
    }

    try {
        const parents = await new Promise((resolve, reject) => {
            db.all(
                `SELECT DISTINCT u.id, u.username, u.display_name
                 FROM users u
                 JOIN parent_bindings pb ON u.id = pb.parent_id
                 WHERE pb.student_id = ? AND u.role = "parent"`,
                [req.user.id],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        res.json({
            success: true,
            parents: parents.map(p => ({
                id: p.id,
                username: p.username,
                displayName: p.display_name
            }))
        });
    } catch (error) {
        console.error('获取家长列表错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 周计划API ====================

// 获取周计划模板
app.get('/api/plans/weekly', authenticateToken, async (req, res) => {
    const { weekStart } = req.query;

    if (!weekStart) {
        return res.status(400).json({ success: false, message: '请提供周开始日期' });
    }

    try {
        const plans = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM weekly_plans WHERE user_id = ? AND week_start = ? ORDER BY date, slot, slot_index',
                [req.user.id, weekStart],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        // 转换为前端需要的格式
        const result = {};
        const weekDays = getWeekDays(weekStart);
        weekDays.forEach(date => {
            result[date] = {
                morning: [null, null],
                afternoon: [null, null],
                evening: [null, null]
            };
        });

        plans.forEach(plan => {
            if (result[plan.date] && result[plan.date][plan.slot]) {
                result[plan.date][plan.slot][plan.slot_index] = {
                    subject: plan.subject,
                    content: plan.content,
                    duration: plan.duration
                };
            }
        });

        res.json({ success: true, plans: result, weekStart });
    } catch (error) {
        console.error('获取周计划错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 保存计划项
app.post('/api/plans/weekly/item', authenticateToken, async (req, res) => {
    const { weekStart, date, slot, slotIndex, subject, content, duration } = req.body;

    try {
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO weekly_plans (user_id, week_start, date, slot, slot_index, subject, content, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, week_start, date, slot, slot_index)
                 DO UPDATE SET subject = ?, content = ?, duration = ?, updated_at = CURRENT_TIMESTAMP`,
                [req.user.id, weekStart, date, slot, slotIndex, subject, content, duration, subject, content, duration],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        res.json({ success: true });
    } catch (error) {
        console.error('保存计划项错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 删除计划项
app.delete('/api/plans/weekly/item', authenticateToken, async (req, res) => {
    const { weekStart, date, slot, slotIndex } = req.body;

    try {
        await new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM weekly_plans WHERE user_id = ? AND week_start = ? AND date = ? AND slot = ? AND slot_index = ?',
                [req.user.id, weekStart, date, slot, slotIndex],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        res.json({ success: true });
    } catch (error) {
        console.error('删除计划项错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 清空周计划
app.delete('/api/plans/weekly', authenticateToken, async (req, res) => {
    const { weekStart } = req.query;

    try {
        await new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM weekly_plans WHERE user_id = ? AND week_start = ?',
                [req.user.id, weekStart],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        res.json({ success: true });
    } catch (error) {
        console.error('清空周计划错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 确认周计划（生成每日任务）
app.post('/api/plans/weekly/confirm', authenticateToken, async (req, res) => {
    const { weekStart } = req.body;

    try {
        // 获取该周所有计划项
        const plans = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM weekly_plans WHERE user_id = ? AND week_start = ? AND subject IS NOT NULL',
                [req.user.id, weekStart],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        if (plans.length === 0) {
            return res.status(400).json({ success: false, message: '该周没有计划内容' });
        }

        // 删除该周已有的任务（避免重复）
        const weekDays = getWeekDays(weekStart);
        for (const date of weekDays) {
            await new Promise((resolve, reject) => {
                db.run(
                    'DELETE FROM daily_tasks WHERE user_id = ? AND date = ? AND from_plan = 1',
                    [req.user.id, date],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });
        }

        // 生成每日任务
        for (const plan of plans) {
            const priority = getSubjectPriority(plan.subject);
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO daily_tasks (user_id, date, subject, slot, content, duration, priority, from_plan)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
                    [req.user.id, plan.date, plan.subject, plan.slot, plan.content || `${plan.subject}学习`, plan.duration || 60, priority],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });
        }

        res.json({ success: true, message: '计划已确认，任务已生成' });
    } catch (error) {
        console.error('确认计划错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 检查周计划是否已确认
app.get('/api/plans/weekly/confirmed', authenticateToken, async (req, res) => {
    const { weekStart } = req.query;

    try {
        const tasks = await new Promise((resolve, reject) => {
            db.get(
                'SELECT COUNT(*) as count FROM daily_tasks WHERE user_id = ? AND date >= ? AND date <= ? AND from_plan = 1',
                [req.user.id, weekStart, getWeekDays(weekStart)[6]],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });

        res.json({ success: true, confirmed: tasks.count > 0 });
    } catch (error) {
        console.error('检查确认状态错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 每日任务API ====================

// 获取某天任务
app.get('/api/tasks/daily', authenticateToken, async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ success: false, message: '请提供日期' });
    }

    try {
        // 获取计划任务
        const planTasks = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM daily_tasks WHERE user_id = ? AND date = ? ORDER BY slot',
                [req.user.id, date],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        // 获取自定义任务
        const customTasks = await new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM custom_tasks WHERE user_id = ? AND date = ? ORDER BY slot',
                [req.user.id, date],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        const allTasks = [
            ...planTasks.map(t => ({
                id: `plan_${t.id}`,
                subject: t.subject,
                slot: t.slot,
                content: t.content,
                duration: t.duration,
                priority: t.priority,
                completed: !!t.completed,
                completedAt: t.completed_at,
                fromPlan: true
            })),
            ...customTasks.map(t => ({
                id: `custom_${t.id}`,
                subject: t.subject,
                slot: t.slot,
                content: t.content,
                duration: t.duration,
                priority: t.priority,
                completed: !!t.completed,
                completedAt: t.completed_at,
                fromPlan: false
            }))
        ];

        res.json({ success: true, tasks: allTasks, date });
    } catch (error) {
        console.error('获取每日任务错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 添加自定义任务
app.post('/api/tasks/custom', authenticateToken, async (req, res) => {
    const { date, subject, slot, content, duration, priority } = req.body;

    try {
        const result = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO custom_tasks (user_id, date, subject, slot, content, duration, priority)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, date, subject, slot, content, duration || 60, priority || 'medium'],
                function(err) {
                    if (err) reject(err);
                    resolve({ id: this.lastID });
                }
            );
        });

        res.json({ success: true, taskId: result.id });
    } catch (error) {
        console.error('添加自定义任务错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 切换任务完成状态
app.patch('/api/tasks/:type/:id/toggle', authenticateToken, async (req, res) => {
    const { type, id } = req.params;
    const table = type === 'plan' ? 'daily_tasks' : 'custom_tasks';
    const idValue = parseInt(id.replace(`${type}_`, ''));

    try {
        // 获取当前状态
        const task = await new Promise((resolve, reject) => {
            db.get(
                `SELECT completed FROM ${table} WHERE id = ? AND user_id = ?`,
                [idValue, req.user.id],
                (err, row) => {
                    if (err) reject(err);
                    resolve(row);
                }
            );
        });

        if (!task) {
            return res.status(404).json({ success: false, message: '任务不存在' });
        }

        const newCompleted = !task.completed;
        const completedAt = newCompleted ? new Date().toISOString() : null;

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE ${table} SET completed = ?, completed_at = ? WHERE id = ?`,
                [newCompleted ? 1 : 0, completedAt, idValue],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        res.json({ success: true, completed: newCompleted });
    } catch (error) {
        console.error('切换任务状态错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 删除自定义任务
app.delete('/api/tasks/custom/:id', authenticateToken, async (req, res) => {
    const id = parseInt(req.params.id.replace('custom_', ''));

    try {
        await new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM custom_tasks WHERE id = ? AND user_id = ?',
                [id, req.user.id],
                (err) => {
                    if (err) reject(err);
                    resolve();
                }
            );
        });

        res.json({ success: true });
    } catch (error) {
        console.error('删除任务错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 统计API ====================

// 获取统计数据
app.get('/api/stats', authenticateToken, async (req, res) => {
    const { period } = req.query; // week, month, all

    try {
        let dateFilter = '';
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        if (period === 'week') {
            const weekStart = getWeekStart(today);
            dateFilter = `AND date >= '${weekStart}' AND date <= '${today}'`;
        } else if (period === 'month') {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            dateFilter = `AND date >= '${monthStart}' AND date <= '${today}'`;
        }

        // 获取所有任务统计
        const allTasks = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 'plan' as type, subject, slot, duration, completed, date FROM daily_tasks WHERE user_id = ? ${dateFilter}
                 UNION ALL
                 SELECT 'custom' as type, subject, slot, duration, completed, date FROM custom_tasks WHERE user_id = ? ${dateFilter}`,
                [req.user.id, req.user.id],
                (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                }
            );
        });

        const stats = {
            totalTasks: allTasks.length,
            completedTasks: allTasks.filter(t => t.completed).length,
            subjectStats: {},
            dailyStats: {},
            timeDistribution: { morning: 0, afternoon: 0, evening: 0 }
        };

        const subjects = ['语文', '数学', '英语', '物理', '化学', '课外编程', '篮球', '其他'];
        subjects.forEach(s => {
            stats.subjectStats[s] = { total: 0, completed: 0, totalDuration: 0 };
        });

        allTasks.forEach(task => {
            if (stats.subjectStats[task.subject]) {
                stats.subjectStats[task.subject].total++;
                if (task.completed) stats.subjectStats[task.subject].completed++;
                stats.subjectStats[task.subject].totalDuration += task.duration || 0;
            }

            if (task.slot) {
                stats.timeDistribution[task.slot] += task.duration || 0;
            }

            if (!stats.dailyStats[task.date]) {
                stats.dailyStats[task.date] = { total: 0, completed: 0 };
            }
            stats.dailyStats[task.date].total++;
            if (task.completed) stats.dailyStats[task.date].completed++;
        });

        res.json({ success: true, stats });
    } catch (error) {
        console.error('获取统计错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 数据导出/导入API ====================

// 导出所有数据
app.get('/api/data/export', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [weeklyPlans, dailyTasks, customTasks] = await Promise.all([
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM weekly_plans WHERE user_id = ?', [userId], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                });
            }),
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM daily_tasks WHERE user_id = ?', [userId], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                });
            }),
            new Promise((resolve, reject) => {
                db.all('SELECT * FROM custom_tasks WHERE user_id = ?', [userId], (err, rows) => {
                    if (err) reject(err);
                    resolve(rows || []);
                });
            })
        ]);

        res.json({
            success: true,
            data: {
                weeklyPlans,
                dailyTasks,
                customTasks,
                exportDate: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('导出数据错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// 导入数据
app.post('/api/data/import', authenticateToken, async (req, res) => {
    const { data } = req.body;

    try {
        const userId = req.user.id;

        // 导入周计划
        if (data.weeklyPlans) {
            for (const plan of data.weeklyPlans) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO weekly_plans (user_id, week_start, date, slot, slot_index, subject, content, duration)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT(user_id, week_start, date, slot, slot_index)
                         DO UPDATE SET subject = ?, content = ?, duration = ?`,
                        [userId, plan.week_start, plan.date, plan.slot, plan.slot_index, plan.subject, plan.content, plan.duration, plan.subject, plan.content, plan.duration],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });
            }
        }

        // 导入自定义任务
        if (data.customTasks) {
            for (const task of data.customTasks) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO custom_tasks (user_id, date, subject, slot, content, duration, priority, completed, completed_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [userId, task.date, task.subject, task.slot, task.content, task.duration, task.priority, task.completed, task.completed_at],
                        (err) => {
                            if (err) reject(err);
                            resolve();
                        }
                    );
                });
            }
        }

        res.json({ success: true, message: '数据导入成功' });
    } catch (error) {
        console.error('导入数据错误:', error);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
});

// ==================== 工具函数 ====================

function getWeekStart(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
}

function getWeekDays(weekStart) {
    const days = [];
    const start = new Date(weekStart);
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
}

function getSubjectPriority(subject) {
    const lowPriority = ['篮球', '其他'];
    const mediumPriority = ['课外编程'];
    if (lowPriority.includes(subject)) return 'low';
    if (mediumPriority.includes(subject)) return 'medium';
    return 'high';
}

// 启动服务器
app.listen(PORT, () => {
    console.log(`暑期学习计划服务器运行在端口 ${PORT}`);
    console.log(`本地访问: http://localhost:${PORT}`);
});

module.exports = app;
