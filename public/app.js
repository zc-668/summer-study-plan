/**
 * 暑期学习计划 - 在线版前端
 * 连接后端 API，支持多设备同步
 */

// ==================== 配置 ====================
const CONFIG = {
    SUBJECTS: ['语文', '数学', '英语', '物理', '化学', '课外编程', '篮球', '其他'],
    SLOTS: {
        morning: { name: '上午', hours: 2, start: '08:00', end: '10:00' },
        afternoon: { name: '下午', hours: 2, start: '14:00', end: '16:00' },
        evening: { name: '晚上', hours: 2.5, start: '19:00', end: '21:30' }
    },
    TOTAL_WEEKS: 8,
    API_BASE: ''  // 同域部署，使用相对路径
};

// ==================== API 客户端 ====================
class APIClient {
    constructor() {
        this.token = localStorage.getItem('auth_token');
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }

    async request(method, endpoint, body = null) {
        const options = {
            method,
            headers: this.getHeaders()
        };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, options);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '请求失败');
        }
        return data;
    }

    get(endpoint) { return this.request('GET', endpoint); }
    post(endpoint, body) { return this.request('POST', endpoint, body); }
    patch(endpoint, body) { return this.request('PATCH', endpoint, body); }
    delete(endpoint, body) { return this.request('DELETE', endpoint, body); }

    setToken(token) {
        this.token = token;
        localStorage.setItem('auth_token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('auth_token');
    }
}

// ==================== 数据存储（在线版） ====================
class DataStore {
    constructor(api) {
        this.api = api;
        this.currentUser = null;
    }

    async loadUser() {
        try {
            const data = await this.api.get('/api/auth/me');
            if (data.success) {
                this.currentUser = data.user;
                return data.user;
            }
        } catch (e) {
            console.log('未登录');
        }
        return null;
    }

    getTodayStr() {
        return new Date().toISOString().split('T')[0];
    }

    getWeekStart(dateStr) {
        const d = new Date(dateStr);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        return monday.toISOString().split('T')[0];
    }

    getWeekDays(weekStart) {
        const days = [];
        const start = new Date(weekStart);
        for (let i = 0; i < 7; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            days.push(d.toISOString().split('T')[0]);
        }
        return days;
    }

    getNextWeekStart(dateStr) {
        const d = new Date(dateStr);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) + 7;
        const nextMonday = new Date(d.setDate(diff));
        return nextMonday.toISOString().split('T')[0];
    }
}

// ==================== AI 建议引擎 ====================
class AIAdviceEngine {
    constructor(dataStore) {
        this.dataStore = dataStore;
    }

    async generateAdvice(userId) {
        const advice = [];
        const today = this.dataStore.getTodayStr();

        try {
            // 获取今日任务
            const todayData = await this.dataStore.api.get(`/api/tasks/daily?date=${today}`);
            const todayTasks = todayData.tasks || [];
            const todayCompleted = todayTasks.filter(t => t.completed).length;
            const todayTotal = todayTasks.length;
            const todayRate = todayTotal > 0 ? todayCompleted / todayTotal : 0;

            if (todayRate === 0 && todayTasks.length > 0) {
                advice.push({
                    type: 'danger',
                    title: '今日尚未开始学习',
                    content: `今天还有 ${todayTasks.length} 项任务等待完成。建议立即开始，哪怕先完成一项也能建立良好的学习节奏。`,
                    source: '实时分析'
                });
            } else if (todayRate < 0.5 && todayTasks.length > 0) {
                advice.push({
                    type: 'warning',
                    title: '今日进度较慢',
                    content: `目前完成了 ${Math.round(todayRate * 100)}%，建议优先完成高优先级任务，合理分配剩余时间。`,
                    source: '实时分析'
                });
            } else if (todayRate >= 0.8) {
                advice.push({
                    type: 'success',
                    title: '今日表现优秀！',
                    content: '你已经完成了大部分任务，保持良好的学习节奏！',
                    source: '实时分析'
                });
            }

            // 获取统计数据
            const statsData = await this.dataStore.api.get('/api/stats?period=all');
            const allStats = statsData.stats;

            if (allStats) {
                // 科目均衡分析
                const subjectRates = {};
                Object.entries(allStats.subjectStats || {}).forEach(([subject, stat]) => {
                    if (stat.total > 0) {
                        subjectRates[subject] = stat.completed / stat.total;
                    }
                });

                const sortedSubjects = Object.entries(subjectRates).sort((a, b) => a[1] - b[1]);
                const weakest = sortedSubjects[0];
                const strongest = sortedSubjects[sortedSubjects.length - 1];

                if (weakest && weakest[1] < 0.6) {
                    advice.push({
                        type: 'warning',
                        title: `${weakest[0]} 需要加强`,
                        content: `${weakest[0]} 的完成率仅为 ${Math.round(weakest[1] * 100)}%，建议增加该科目的学习时间，或调整学习计划使其更易于执行。`,
                        source: '科目分析'
                    });
                }

                if (strongest && strongest[1] > 0.9) {
                    advice.push({
                        type: 'success',
                        title: `${strongest[0]} 表现突出`,
                        content: `${strongest[0]} 的完成率高达 ${Math.round(strongest[1] * 100)}%，继续保持！`,
                        source: '科目分析'
                    });
                }

                // 时间分配分析
                const totalTime = Object.values(allStats.timeDistribution || {}).reduce((a, b) => a + b, 0);
                if (totalTime > 0) {
                    const eveningRatio = (allStats.timeDistribution?.evening || 0) / totalTime;
                    if (eveningRatio > 0.5) {
                        advice.push({
                            type: 'warning',
                            title: '晚间学习负担较重',
                            content: '超过50%的学习时间集中在晚上，长期可能影响休息。建议将部分任务调整到上午或下午完成。',
                            source: '时间分析'
                        });
                    }
                }

                // 连续完成情况分析
                const dailyStats = allStats.dailyStats || {};
                const dates = Object.keys(dailyStats).sort();
                let streak = 0;
                let brokenStreak = false;

                for (let i = dates.length - 1; i >= 0; i--) {
                    const day = dailyStats[dates[i]];
                    const rate = day.total > 0 ? day.completed / day.total : 0;
                    if (rate >= 0.7) {
                        if (!brokenStreak) streak++;
                    } else {
                        brokenStreak = true;
                    }
                }

                if (streak >= 3) {
                    advice.push({
                        type: 'success',
                        title: `连续 ${streak} 天表现优秀！`,
                        content: '你保持了良好的学习习惯，这种坚持会带来显著的进步。',
                        source: '习惯分析'
                    });
                } else if (streak === 0 && dates.length > 0) {
                    const lastDay = dailyStats[dates[dates.length - 1]];
                    const lastRate = lastDay.total > 0 ? lastDay.completed / lastDay.total : 0;
                    if (lastRate < 0.5) {
                        advice.push({
                            type: 'danger',
                            title: '学习连续性中断',
                            content: '昨天完成度较低，今天是一个新的开始，建议从最简单的任务入手，重建学习节奏。',
                            source: '习惯分析'
                        });
                    }
                }

                // 运动建议
                const weeklyStats = await this.dataStore.api.get('/api/stats?period=week');
                const sportStat = weeklyStats.stats?.subjectStats?.['篮球'] || { totalDuration: 0 };
                if (sportStat.totalDuration < 60) {
                    advice.push({
                        type: 'warning',
                        title: '运动时间不足',
                        content: '本周运动时间较少，建议每天安排至少30分钟体育活动，保持身体健康和学习效率。',
                        source: '健康分析'
                    });
                }
            }
        } catch (e) {
            console.error('生成建议错误:', e);
        }

        return advice.length > 0 ? advice : [{
            type: 'success',
            title: '一切正常',
            content: '你的学习状态良好，继续保持！',
            source: '综合分析'
        }];
    }
}

// ==================== UI 控制器 ====================
class UIController {
    constructor(dataStore, adviceEngine) {
        this.dataStore = dataStore;
        this.adviceEngine = adviceEngine;
        this.currentView = 'today';
        this.currentWeekOffset = 0;
        this.planWeekOffset = 0;
        this.selectedChild = null;
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAuth();
        this.updateDateDisplay();
    }

    bindEvents() {
        // 认证标签切换
        document.querySelectorAll('.auth-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchAuthTab(btn.dataset.tab));
        });

        // 登录
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // 注册
        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister();
        });

        // 免登录
        document.getElementById('guest-btn').addEventListener('click', () => {
            this.showNotification('在线版需要注册登录才能同步数据');
        });

        // 导航
        document.querySelectorAll('.tab-nav .nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchView(btn.dataset.view));
        });

        // 添加任务
        document.getElementById('add-task-btn').addEventListener('click', () => {
            this.openTaskModal();
        });

        document.getElementById('cancel-task').addEventListener('click', () => {
            this.closeTaskModal();
        });

        document.getElementById('task-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTask();
        });

        // 设置
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.openSettings();
        });

        document.querySelector('#settings-modal .close-modal').addEventListener('click', () => {
            this.closeSettings();
        });

        document.getElementById('export-data').addEventListener('click', () => {
            this.exportData();
        });

        document.getElementById('import-data').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });

        // 退出
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('parent-logout-btn').addEventListener('click', () => this.logout());

        // 周导航
        document.getElementById('prev-week').addEventListener('click', () => {
            this.currentWeekOffset--;
            this.renderWeekView();
        });

        document.getElementById('next-week').addEventListener('click', () => {
            this.currentWeekOffset++;
            this.renderWeekView();
        });

        // 统计筛选
        document.querySelectorAll('.stats-filters .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.stats-filters .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderStats(btn.dataset.period);
            });
        });

        // 刷新建议
        document.getElementById('refresh-advice').addEventListener('click', () => {
            this.renderAdvice();
        });

        // 注册角色切换
        document.querySelectorAll('input[name="reg-role"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const isStudent = radio.value === 'student';
                document.getElementById('reg-parent-code').style.display = isStudent ? 'block' : 'none';
            });
        });

        // 计划模块事件
        document.getElementById('plan-prev-week').addEventListener('click', () => {
            this.planWeekOffset--;
            this.renderPlanView();
        });

        document.getElementById('plan-next-week').addEventListener('click', () => {
            this.planWeekOffset++;
            this.renderPlanView();
        });

        document.getElementById('cancel-plan-item').addEventListener('click', () => {
            this.closePlanItemModal();
        });

        document.getElementById('plan-item-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.savePlanItem();
        });

        document.getElementById('save-plan-btn').addEventListener('click', () => {
            this.confirmWeeklyPlan();
        });

        document.getElementById('clear-plan-btn').addEventListener('click', () => {
            this.clearWeeklyPlan();
        });
    }

    async checkAuth() {
        const user = await this.dataStore.loadUser();
        if (user) {
            if (user.role === 'student') {
                this.showStudentScreen();
            } else {
                this.showParentScreen();
            }
        }
    }

    switchAuthTab(tab) {
        document.querySelectorAll('.auth-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.auth-tabs .tab-btn[data-tab="${tab}"]`).classList.add('active');

        document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
        document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    }

    async handleLogin() {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const role = document.querySelector('input[name="role"]:checked').value;

        try {
            const result = await this.dataStore.api.post('/api/auth/login', { username, password });
            if (result.success) {
                if (result.user.role !== role) {
                    this.showNotification('角色选择错误', 'error');
                    return;
                }
                this.dataStore.api.setToken(result.token);
                this.dataStore.currentUser = result.user;
                if (role === 'student') {
                    this.showStudentScreen();
                } else {
                    this.showParentScreen();
                }
                this.showNotification('登录成功！');
            }
        } catch (e) {
            this.showNotification(e.message || '登录失败', 'error');
        }
    }

    async handleRegister() {
        const username = document.getElementById('reg-username').value;
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-password-confirm').value;
        const displayName = document.getElementById('reg-display-name').value;
        const role = document.querySelector('input[name="reg-role"]:checked').value;
        const parentCode = document.getElementById('reg-parent-code').value;

        if (password !== confirm) {
            this.showNotification('两次密码不一致', 'error');
            return;
        }

        try {
            const result = await this.dataStore.api.post('/api/auth/register', {
                username, password, displayName, role, parentCode
            });
            if (result.success) {
                this.dataStore.api.setToken(result.token);
                this.dataStore.currentUser = result.user;
                if (role === 'student') {
                    this.showNotification(`注册成功！家长绑定码：${result.user.parentCode}`);
                    this.showStudentScreen();
                } else {
                    this.showNotification('注册成功！');
                    this.showParentScreen();
                }
            }
        } catch (e) {
            this.showNotification(e.message || '注册失败', 'error');
        }
    }

    logout() {
        this.dataStore.api.clearToken();
        this.dataStore.currentUser = null;
        location.reload();
    }

    showStudentScreen() {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('student-screen').classList.remove('hidden');
        document.getElementById('parent-screen').classList.add('hidden');
        this.renderTodayView();
    }

    async showParentScreen() {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('student-screen').classList.add('hidden');
        document.getElementById('parent-screen').classList.remove('hidden');

        try {
            const data = await this.dataStore.api.get('/api/parent/children');
            const children = data.children || [];
            if (children.length > 0) {
                this.selectedChild = children[0];
                this.renderChildSelector(children);
                this.renderParentTodayView();
            } else {
                document.getElementById('child-selector').innerHTML = '<p style="padding: 16px; color: #999;">尚未绑定学生，请使用学生提供的绑定码进行绑定</p>';
            }
        } catch (e) {
            console.error('获取学生列表失败:', e);
        }
    }

    renderChildSelector(children) {
        const container = document.getElementById('child-selector');
        container.innerHTML = children.map(child => `
            <div class="child-card ${this.selectedChild?.id === child.id ? 'active' : ''}" data-id="${child.id}">
                <div class="child-avatar">${child.displayName[0]}</div>
                <span>${child.displayName}</span>
            </div>
        `).join('');

        container.querySelectorAll('.child-card').forEach(card => {
            card.addEventListener('click', () => {
                this.selectedChild = children.find(c => c.id === parseInt(card.dataset.id));
                this.renderChildSelector(children);
                this.renderParentView();
            });
        });
    }

    switchView(view) {
        this.currentView = view;

        document.querySelectorAll('.tab-nav .nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.tab-nav .nav-btn[data-view="${view}"]`).classList.add('active');

        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

        if (view === 'today') {
            document.getElementById('today-view').classList.remove('hidden');
            this.renderTodayView();
        } else if (view === 'plan') {
            document.getElementById('plan-view').classList.remove('hidden');
            this.renderPlanView();
        } else if (view === 'week') {
            document.getElementById('week-view').classList.remove('hidden');
            this.renderWeekView();
        } else if (view === 'stats') {
            document.getElementById('stats-view').classList.remove('hidden');
            this.renderStats('week');
        } else if (view === 'advice') {
            document.getElementById('advice-view').classList.remove('hidden');
            this.renderAdvice();
        }
    }

    async renderTodayView() {
        const userId = this.dataStore.currentUser?.id;
        if (!userId) return;

        const today = this.dataStore.getTodayStr();

        try {
            const data = await this.dataStore.api.get(`/api/tasks/daily?date=${today}`);
            const tasks = data.tasks || [];

            // 更新进度
            const completed = tasks.filter(t => t.completed).length;
            const total = tasks.length;
            const rate = total > 0 ? completed / total : 0;

            document.getElementById('completed-count').textContent = completed;
            document.getElementById('total-count').textContent = total;

            // 更新圆环
            const circle = document.getElementById('today-progress');
            const circumference = 2 * Math.PI * 45;
            circle.style.strokeDasharray = circumference;
            circle.style.strokeDashoffset = circumference * (1 - rate);

            // 按时段渲染任务
            ['morning', 'afternoon', 'evening'].forEach(slot => {
                const slotTasks = tasks.filter(t => t.slot === slot);
                const container = document.getElementById(`${slot}-tasks`);

                if (slotTasks.length === 0) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">📝</div>
                            <p>该时段暂无任务</p>
                        </div>
                    `;
                } else {
                    container.innerHTML = slotTasks.map(task => this.renderTaskCard(task)).join('');

                    // 绑定事件
                    container.querySelectorAll('.task-checkbox').forEach(cb => {
                        cb.addEventListener('click', () => {
                            this.toggleTask(task.id);
                        });
                    });

                    container.querySelectorAll('.task-action-btn.delete').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.deleteTask(task.id);
                        });
                    });
                }
            });
        } catch (e) {
            console.error('获取今日任务失败:', e);
        }
    }

    renderTaskCard(task) {
        const priorityClass = `priority-${task.priority}`;
        return `
            <div class="task-card ${task.completed ? 'completed' : ''}" data-id="${task.id}">
                <div class="task-checkbox"></div>
                <div class="task-info">
                    <div class="task-subject">${task.subject}</div>
                    <div class="task-content">${task.content}</div>
                    <div class="task-meta">
                        <span>${task.duration}分钟</span>
                        <span class="priority-badge ${priorityClass}">${task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}</span>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="task-action-btn delete" title="删除">🗑️</button>
                </div>
            </div>
        `;
    }

    async toggleTask(taskId) {
        try {
            const type = taskId.startsWith('plan_') ? 'plan' : 'custom';
            const id = taskId.replace(`${type}_`, '');
            const result = await this.dataStore.api.patch(`/api/tasks/${type}/${id}/toggle`);

            if (result.success) {
                this.renderTodayView();
                if (result.completed) {
                    this.showNotification('任务完成！继续保持！', 'success');
                }
            }
        } catch (e) {
            this.showNotification('操作失败', 'error');
        }
    }

    async deleteTask(taskId) {
        if (!confirm('确定要删除这个任务吗？')) return;

        try {
            if (taskId.startsWith('custom_')) {
                const id = taskId.replace('custom_', '');
                await this.dataStore.api.delete(`/api/tasks/custom/${id}`);
                this.renderTodayView();
                this.showNotification('任务已删除');
            } else {
                this.showNotification('计划任务不能删除，只能完成', 'warning');
            }
        } catch (e) {
            this.showNotification('删除失败', 'error');
        }
    }

    openTaskModal() {
        document.getElementById('task-modal').classList.remove('hidden');
        document.getElementById('modal-title').textContent = '添加学习任务';
        document.getElementById('task-form').reset();
    }

    closeTaskModal() {
        document.getElementById('task-modal').classList.add('hidden');
    }

    async saveTask() {
        const today = this.dataStore.getTodayStr();

        const task = {
            date: today,
            subject: document.getElementById('task-subject').value,
            slot: document.getElementById('task-slot').value,
            content: document.getElementById('task-content').value,
            duration: parseInt(document.getElementById('task-duration').value),
            priority: document.getElementById('task-priority').value
        };

        try {
            await this.dataStore.api.post('/api/tasks/custom', task);
            this.closeTaskModal();
            this.renderTodayView();
            this.showNotification('任务添加成功', 'success');
        } catch (e) {
            this.showNotification('添加失败', 'error');
        }
    }

    // ==================== 计划制定视图 ====================
    async renderPlanView() {
        const userId = this.dataStore.currentUser?.id;
        if (!userId) return;

        const today = this.dataStore.getTodayStr();
        const baseDate = new Date(today);
        baseDate.setDate(baseDate.getDate() + this.planWeekOffset * 7);
        const displayWeekStart = this.dataStore.getWeekStart(baseDate.toISOString().split('T')[0]);

        const weekDays = this.dataStore.getWeekDays(displayWeekStart);

        // 检查是否已确认
        let isConfirmed = false;
        try {
            const confirmData = await this.dataStore.api.get(`/api/plans/weekly/confirmed?weekStart=${displayWeekStart}`);
            isConfirmed = confirmData.confirmed;
        } catch (e) {
            console.error('检查确认状态失败:', e);
        }

        // 更新状态标签
        const statusEl = document.getElementById('plan-status');
        if (isConfirmed) {
            statusEl.innerHTML = '<span class="status-badge confirmed">已确认</span>';
        } else {
            statusEl.innerHTML = '<span class="status-badge pending">待制定</span>';
        }

        // 更新周标签
        const weekLabel = document.getElementById('plan-week-label');
        const todayWeekStart = this.dataStore.getWeekStart(today);
        const nextWeekStart = this.dataStore.getNextWeekStart(today);
        if (displayWeekStart === todayWeekStart) {
            weekLabel.textContent = '本周';
        } else if (displayWeekStart === nextWeekStart) {
            weekLabel.textContent = '下周';
        } else {
            weekLabel.textContent = displayWeekStart.slice(5) + '周';
        }

        // 获取周计划
        let weeklyPlan = {};
        try {
            const planData = await this.dataStore.api.get(`/api/plans/weekly?weekStart=${displayWeekStart}`);
            weeklyPlan = planData.plans || {};
        } catch (e) {
            console.error('获取周计划失败:', e);
        }

        // 渲染7天计划表
        const container = document.getElementById('plan-days');
        const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

        container.innerHTML = weekDays.map((date, dayIndex) => {
            const dayPlan = weeklyPlan[date] || { morning: [null, null], afternoon: [null, null], evening: [null, null] };
            const isToday = date === today;

            return `
                <div class="plan-day-card ${isToday ? 'plan-today' : ''}">
                    <div class="plan-day-header">
                        <span class="plan-day-title">${dayNames[dayIndex]} ${isToday ? '(今天)' : ''}</span>
                        <span class="plan-day-date">${date}</span>
                    </div>

                    <div class="plan-slot">
                        <div class="plan-slot-header">上午 2小时</div>
                        <div class="plan-slot-items">
                            ${this.renderPlanItem(userId, displayWeekStart, date, 'morning', 0, dayPlan.morning?.[0], isConfirmed)}
                            ${this.renderPlanItem(userId, displayWeekStart, date, 'morning', 1, dayPlan.morning?.[1], isConfirmed)}
                        </div>
                    </div>

                    <div class="plan-slot">
                        <div class="plan-slot-header">下午 2小时</div>
                        <div class="plan-slot-items">
                            ${this.renderPlanItem(userId, displayWeekStart, date, 'afternoon', 0, dayPlan.afternoon?.[0], isConfirmed)}
                            ${this.renderPlanItem(userId, displayWeekStart, date, 'afternoon', 1, dayPlan.afternoon?.[1], isConfirmed)}
                        </div>
                    </div>

                    <div class="plan-slot">
                        <div class="plan-slot-header">晚上 2.5小时</div>
                        <div class="plan-slot-items">
                            ${this.renderPlanItem(userId, displayWeekStart, date, 'evening', 0, dayPlan.evening?.[0], isConfirmed)}
                            ${this.renderPlanItem(userId, displayWeekStart, date, 'evening', 1, dayPlan.evening?.[1], isConfirmed)}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定点击事件
        container.querySelectorAll('.plan-item-empty').forEach(el => {
            el.addEventListener('click', () => {
                if (isConfirmed) {
                    this.showNotification('本周计划已确认，无法修改。如需调整请使用"今日"视图的添加任务功能。', 'warning');
                    return;
                }
                this.openPlanItemModal(
                    el.dataset.date,
                    el.dataset.slot,
                    parseInt(el.dataset.index)
                );
            });
        });

        container.querySelectorAll('.plan-item-filled').forEach(el => {
            el.addEventListener('click', () => {
                if (isConfirmed) {
                    this.showNotification('本周计划已确认，无法修改。', 'warning');
                    return;
                }
                this.editPlanItemModal(
                    el.dataset.date,
                    el.dataset.slot,
                    parseInt(el.dataset.index),
                    {
                        subject: el.dataset.subject,
                        content: el.dataset.content,
                        duration: parseInt(el.dataset.duration)
                    }
                );
            });
        });

        container.querySelectorAll('.plan-item-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isConfirmed) {
                    this.showNotification('本周计划已确认，无法删除。', 'warning');
                    return;
                }
                if (confirm('确定要删除这个计划项吗？')) {
                    this.deletePlanItem(
                        displayWeekStart,
                        btn.dataset.date,
                        btn.dataset.slot,
                        parseInt(btn.dataset.index)
                    );
                }
            });
        });

        // 更新按钮状态
        const saveBtn = document.getElementById('save-plan-btn');
        if (isConfirmed) {
            saveBtn.textContent = '本周计划已确认';
            saveBtn.disabled = true;
        } else {
            saveBtn.textContent = '确认并生成本周任务';
            saveBtn.disabled = false;
        }
    }

    renderPlanItem(userId, weekStart, date, slot, index, item, isConfirmed) {
        if (item && item.subject) {
            return `
                <div class="plan-item-filled"
                     data-date="${date}"
                     data-slot="${slot}"
                     data-index="${index}"
                     data-subject="${item.subject}"
                     data-content="${item.content || ''}"
                     data-duration="${item.duration || 60}">
                    <span class="plan-item-subject-badge ${item.subject}">${item.subject}</span>
                    <div class="plan-item-info">
                        <div class="plan-item-content">${item.content || item.subject + '学习'}</div>
                        <div class="plan-item-duration">${item.duration || 60}分钟</div>
                    </div>
                    <button class="plan-item-delete"
                            data-date="${date}"
                            data-slot="${slot}"
                            data-index="${index}"
                            ${isConfirmed ? 'style="display:none"' : ''}>🗑️</button>
                </div>
            `;
        } else {
            return `
                <div class="plan-item-empty"
                     data-date="${date}"
                     data-slot="${slot}"
                     data-index="${index}">
                    <span class="add-icon">+</span>
                    <span>添加计划</span>
                </div>
            `;
        }
    }

    openPlanItemModal(date, slot, index) {
        document.getElementById('plan-item-modal').classList.remove('hidden');
        document.getElementById('plan-modal-title').textContent = '添加计划项';
        document.getElementById('plan-item-form').reset();
        document.getElementById('plan-item-day').value = date;
        document.getElementById('plan-item-slot').value = slot;
        document.getElementById('plan-item-index').value = index;
    }

    editPlanItemModal(date, slot, index, item) {
        this.openPlanItemModal(date, slot, index);
        document.getElementById('plan-modal-title').textContent = '编辑计划项';
        document.getElementById('plan-item-subject').value = item.subject;
        document.getElementById('plan-item-content').value = item.content || '';
        document.getElementById('plan-item-duration').value = item.duration || 60;
    }

    closePlanItemModal() {
        document.getElementById('plan-item-modal').classList.add('hidden');
    }

    async savePlanItem() {
        const today = this.dataStore.getTodayStr();
        const baseDate = new Date(today);
        baseDate.setDate(baseDate.getDate() + this.planWeekOffset * 7);
        const weekStart = this.dataStore.getWeekStart(baseDate.toISOString().split('T')[0]);

        const date = document.getElementById('plan-item-day').value;
        const slot = document.getElementById('plan-item-slot').value;
        const index = parseInt(document.getElementById('plan-item-index').value);

        const item = {
            weekStart,
            date,
            slot,
            slotIndex: index,
            subject: document.getElementById('plan-item-subject').value,
            content: document.getElementById('plan-item-content').value,
            duration: parseInt(document.getElementById('plan-item-duration').value)
        };

        try {
            await this.dataStore.api.post('/api/plans/weekly/item', item);
            this.closePlanItemModal();
            this.renderPlanView();
            this.showNotification('计划项已保存', 'success');
        } catch (e) {
            this.showNotification('保存失败', 'error');
        }
    }

    async deletePlanItem(weekStart, date, slot, index) {
        try {
            await this.dataStore.api.delete('/api/plans/weekly/item', {
                weekStart, date, slot, slotIndex: index
            });
            this.renderPlanView();
            this.showNotification('计划项已删除');
        } catch (e) {
            this.showNotification('删除失败', 'error');
        }
    }

    async confirmWeeklyPlan() {
        const today = this.dataStore.getTodayStr();
        const baseDate = new Date(today);
        baseDate.setDate(baseDate.getDate() + this.planWeekOffset * 7);
        const displayWeekStart = this.dataStore.getWeekStart(baseDate.toISOString().split('T')[0]);

        try {
            // 检查是否有内容
            const planData = await this.dataStore.api.get(`/api/plans/weekly?weekStart=${displayWeekStart}`);
            const weeklyPlan = planData.plans || {};

            let hasItems = false;
            Object.values(weeklyPlan).forEach(day => {
                ['morning', 'afternoon', 'evening'].forEach(slot => {
                    if (day[slot]) {
                        day[slot].forEach(item => {
                            if (item && item.subject) hasItems = true;
                        });
                    }
                });
            });

            if (!hasItems) {
                this.showNotification('请至少填写一个计划项', 'warning');
                return;
            }

            // 显示确认预览
            this.showPlanPreview(displayWeekStart, weeklyPlan);
        } catch (e) {
            this.showNotification('获取计划失败', 'error');
        }
    }

    showPlanPreview(weekStart, weeklyPlan) {
        const weekDays = this.dataStore.getWeekDays(weekStart);
        const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        const slotLabels = { morning: '上午', afternoon: '下午', evening: '晚上' };

        let previewHTML = `
            <div class="plan-preview-overlay" id="plan-preview-overlay">
                <div class="plan-preview-content">
                    <div class="plan-preview-header">
                        <h3>计划确认预览</h3>
                        <button class="close-modal" onclick="ui.closePlanPreview()">✕</button>
                    </div>
                    <div class="plan-preview-days">
        `;

        weekDays.forEach((date, i) => {
            const dayPlan = weeklyPlan[date];
            const items = [];

            ['morning', 'afternoon', 'evening'].forEach(slot => {
                if (dayPlan[slot]) {
                    dayPlan[slot].forEach(item => {
                        if (item && item.subject) {
                            items.push({
                                slot: slotLabels[slot],
                                subject: item.subject,
                                content: item.content || item.subject + '学习',
                                duration: item.duration || 60
                            });
                        }
                    });
                }
            });

            if (items.length > 0) {
                previewHTML += `
                    <div class="plan-preview-day">
                        <div class="plan-preview-day-title">${dayNames[i]} ${date}</div>
                        <div class="plan-preview-items">
                            ${items.map(item => `
                                <span class="plan-preview-item">${item.slot} · ${item.subject} · ${item.duration}分钟</span>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        });

        previewHTML += `
                    </div>
                    <div class="plan-preview-actions">
                        <button class="plan-preview-cancel" onclick="ui.closePlanPreview()">再改改</button>
                        <button class="plan-preview-confirm" onclick="ui.finalConfirmPlan('${weekStart}')">确认生成任务</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', previewHTML);
    }

    closePlanPreview() {
        const overlay = document.getElementById('plan-preview-overlay');
        if (overlay) overlay.remove();
    }

    async finalConfirmPlan(weekStart) {
        try {
            await this.dataStore.api.post('/api/plans/weekly/confirm', { weekStart });
            this.closePlanPreview();
            this.renderPlanView();
            this.showNotification('周计划已确认，任务已生成！', 'success');
        } catch (e) {
            this.showNotification('确认失败', 'error');
        }
    }

    async clearWeeklyPlan() {
        if (!confirm('确定要清空当前周的所有计划吗？')) return;

        const today = this.dataStore.getTodayStr();
        const baseDate = new Date(today);
        baseDate.setDate(baseDate.getDate() + this.planWeekOffset * 7);
        const displayWeekStart = this.dataStore.getWeekStart(baseDate.toISOString().split('T')[0]);

        try {
            await this.dataStore.api.delete(`/api/plans/weekly?weekStart=${displayWeekStart}`);
            this.renderPlanView();
            this.showNotification('计划已清空');
        } catch (e) {
            this.showNotification('清空失败', 'error');
        }
    }

    // ==================== 周视图 ====================
    async renderWeekView() {
        const userId = this.dataStore.currentUser?.id;
        if (!userId) return;

        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + 1 + this.currentWeekOffset * 7);
        const weekStartStr = weekStart.toISOString().split('T')[0];

        const weekDays = this.dataStore.getWeekDays(weekStartStr);
        const endDay = weekDays[6];

        document.getElementById('week-range').textContent =
            `${weekStartStr.slice(5)} ~ ${endDay.slice(5)}`;

        const weekGrid = document.getElementById('week-grid');
        const dayNames = ['一', '二', '三', '四', '五', '六', '日'];

        try {
            const dayPromises = weekDays.map(async (date, i) => {
                const data = await this.dataStore.api.get(`/api/tasks/daily?date=${date}`);
                const tasks = data.tasks || [];
                const completed = tasks.filter(t => t.completed).length;
                const total = tasks.length;
                const rate = total > 0 ? completed / total : 0;
                const isToday = date === this.dataStore.getTodayStr();

                return `
                    <div class="week-day ${isToday ? 'active' : ''}" data-date="${date}">
                        <div class="week-day-name">周${dayNames[i]}</div>
                        <div class="week-day-date">${date.slice(8)}</div>
                        <div class="week-day-progress">${completed}/${total}</div>
                        <div class="week-day-bar">
                            <div class="week-day-bar-fill" style="width: ${rate * 100}%"></div>
                        </div>
                    </div>
                `;
            });

            weekGrid.innerHTML = (await Promise.all(dayPromises)).join('');

            // 周统计
            let weekTotal = 0, weekCompleted = 0;
            for (const date of weekDays) {
                const data = await this.dataStore.api.get(`/api/tasks/daily?date=${date}`);
                const tasks = data.tasks || [];
                weekTotal += tasks.length;
                weekCompleted += tasks.filter(t => t.completed).length;
            }

            document.getElementById('week-stats').innerHTML = `
                <div class="bar-chart">
                    <div class="bar-item">
                        <div class="bar-label">本周完成</div>
                        <div class="bar-track">
                            <div class="bar-fill" style="width: ${weekTotal > 0 ? (weekCompleted / weekTotal * 100) : 0}%; background: var(--primary);">
                                <span class="bar-value">${weekCompleted}/${weekTotal}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <p style="margin-top: 12px; color: #666; font-size: 14px;">
                    完成率: ${weekTotal > 0 ? Math.round(weekCompleted / weekTotal * 100) : 0}%
                </p>
            `;
        } catch (e) {
            console.error('获取周视图数据失败:', e);
        }
    }

    // ==================== 统计视图 ====================
    async renderStats(period) {
        const userId = this.dataStore.currentUser?.id;
        if (!userId) return;

        try {
            const data = await this.dataStore.api.get(`/api/stats?period=${period}`);
            const stats = data.stats;

            if (!stats) return;

            // 科目统计
            const subjectChart = document.getElementById('subject-chart');
            const subjectData = Object.entries(stats.subjectStats || {})
                .filter(([_, s]) => s.total > 0)
                .sort((a, b) => b[1].total - a[1].total);

            const maxTotal = Math.max(...subjectData.map(([_, s]) => s.total), 1);

            subjectChart.innerHTML = `
                <div class="bar-chart">
                    ${subjectData.map(([subject, s]) => `
                        <div class="bar-item">
                            <div class="bar-label">${subject}</div>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: ${(s.total / maxTotal * 100)}%; background: ${this.getSubjectColor(subject)};">
                                    <span class="bar-value">${s.completed}/${s.total}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

            // 时间分布
            const timeChart = document.getElementById('time-chart');
            const timeData = stats.timeDistribution || {};
            const totalTime = Object.values(timeData).reduce((a, b) => a + b, 0);
            const timeLabels = { morning: '上午', afternoon: '下午', evening: '晚上' };
            const timeColors = { morning: '#4a90e2', afternoon: '#52c41a', evening: '#faad14' };

            timeChart.innerHTML = `
                <div class="bar-chart">
                    ${Object.entries(timeData).map(([slot, minutes]) => `
                        <div class="bar-item">
                            <div class="bar-label">${timeLabels[slot]}</div>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: ${totalTime > 0 ? (minutes / totalTime * 100) : 0}%; background: ${timeColors[slot]};">
                                    <span class="bar-value">${Math.round(minutes / 60 * 10) / 10}h</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <p style="margin-top: 12px; color: #666; font-size: 14px;">
                    总学习时长: ${Math.round(totalTime / 60 * 10) / 10} 小时
                </p>
            `;

            // 趋势图
            this.renderTrendChart(stats.dailyStats || {});
        } catch (e) {
            console.error('获取统计数据失败:', e);
        }
    }

    renderTrendChart(dailyStats) {
        const container = document.getElementById('trend-chart');
        const dates = Object.keys(dailyStats).sort();
        if (dates.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #999;">暂无数据</p>';
            return;
        }

        const data = dates.map(d => {
            const s = dailyStats[d];
            return s.total > 0 ? s.completed / s.total : 0;
        });

        const width = container.clientWidth || 300;
        const height = 200;
        const padding = 30;

        const maxVal = 1;
        const minVal = 0;
        const xStep = (width - padding * 2) / (data.length - 1 || 1);
        const yScale = (height - padding * 2) / (maxVal - minVal);

        const points = data.map((val, i) => ({
            x: padding + i * xStep,
            y: height - padding - val * yScale
        }));

        const pathD = points.length > 0
            ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
            : '';

        const areaD = points.length > 0
            ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
            : '';

        const svg = `
            <svg class="trend-chart-svg" viewBox="0 0 ${width} ${height}">
                ${[0, 0.25, 0.5, 0.75, 1].map(v => {
                    const y = height - padding - v * yScale;
                    return `<line class="trend-grid" x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}"/>`;
                }).join('')}

                <path class="trend-area" d="${areaD}"/>
                <path class="trend-line" d="${pathD}"/>

                ${points.map((p, i) => `
                    <circle class="trend-point" cx="${p.x}" cy="${p.y}"
                            data-date="${dates[i]}" data-value="${Math.round(data[i] * 100)}%"/>
                `).join('')}

                ${dates.map((d, i) => {
                    const x = padding + i * xStep;
                    return `<text x="${x}" y="${height - 10}" font-size="10" text-anchor="middle" fill="#999">${d.slice(5)}</text>`;
                }).join('')}

                ${[0, 50, 100].map(v => {
                    const y = height - padding - (v / 100) * yScale;
                    return `<text x="${padding - 5}" y="${y + 4}" font-size="10" text-anchor="end" fill="#999">${v}%</text>`;
                }).join('')}
            </svg>
        `;

        container.innerHTML = svg;
    }

    getSubjectColor(subject) {
        const colors = {
            '语文': '#e74c3c',
            '数学': '#3498db',
            '英语': '#9b59b6',
            '物理': '#1abc9c',
            '化学': '#f39c12',
            '课外编程': '#2ecc71',
            '篮球': '#e67e22',
            '其他': '#95a5a6'
        };
        return colors[subject] || '#666';
    }

    async renderAdvice() {
        const userId = this.dataStore.currentUser?.id;
        if (!userId) return;

        try {
            const advice = await this.adviceEngine.generateAdvice(userId);
            const container = document.getElementById('advice-list');
            container.innerHTML = advice.map(a => `
                <div class="advice-card ${a.type}">
                    <div class="advice-title">
                        ${a.type === 'success' ? '✅' : a.type === 'warning' ? '⚠️' : '❌'}
                        ${a.title}
                    </div>
                    <div class="advice-content">${a.content}</div>
                    <div class="advice-meta">来源: ${a.source} · ${new Date().toLocaleString()}</div>
                </div>
            `).join('');
        } catch (e) {
            console.error('获取建议失败:', e);
        }
    }

    // ==================== 家长端视图 ====================
    renderParentView() {
        const view = document.querySelector('#parent-screen .nav-btn.active')?.dataset.view;
        if (!view) return;

        if (view === 'parent-today') this.renderParentTodayView();
        else if (view === 'parent-week') this.renderParentWeekView();
        else if (view === 'parent-stats') this.renderParentStats();
        else if (view === 'parent-advice') this.renderParentAdvice();
    }

    async renderParentTodayView() {
        if (!this.selectedChild) return;

        const today = this.dataStore.getTodayStr();

        try {
            const data = await this.dataStore.api.get(`/api/tasks/daily?date=${today}`);
            const tasks = data.tasks || [];
            const completed = tasks.filter(t => t.completed).length;
            const total = tasks.length;
            const rate = total > 0 ? completed / total : 0;

            document.getElementById('parent-today-progress').innerHTML = `
                <div class="progress-overview">
                    <div class="progress-ring">
                        <svg viewBox="0 0 100 100">
                            <circle class="progress-bg" cx="50" cy="50" r="45"/>
                            <circle class="progress-fill" cx="50" cy="50" r="45"
                                    style="stroke-dasharray: ${2 * Math.PI * 45}; stroke-dashoffset: ${2 * Math.PI * 45 * (1 - rate)}"/>
                        </svg>
                        <div class="progress-text">
                            <span>${completed}</span>/${total}
                        </div>
                    </div>
                    <p class="progress-label">${this.selectedChild.displayName} 今日完成度</p>
                </div>
                <div style="padding: 16px;">
                    <h3 style="margin-bottom: 12px;">今日任务</h3>
                    ${tasks.length === 0 ? '<p style="color: #999;">暂无任务</p>' :
                        tasks.map(t => `
                            <div class="task-card ${t.completed ? 'completed' : ''}" style="margin-bottom: 8px;">
                                <div class="task-checkbox ${t.completed ? 'completed' : ''}"></div>
                                <div class="task-info">
                                    <div class="task-subject">${t.subject}</div>
                                    <div class="task-content">${t.content}</div>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            `;
        } catch (e) {
            console.error('获取家长今日数据失败:', e);
        }
    }

    async renderParentWeekView() {
        if (!this.selectedChild) return;

        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay() + 1);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekDays = this.dataStore.getWeekDays(weekStartStr);

        const weekGrid = document.getElementById('parent-week-grid');
        const dayNames = ['一', '二', '三', '四', '五', '六', '日'];

        try {
            const dayPromises = weekDays.map(async (date, i) => {
                const data = await this.dataStore.api.get(`/api/tasks/daily?date=${date}`);
                const tasks = data.tasks || [];
                const completed = tasks.filter(t => t.completed).length;
                const total = tasks.length;
                const rate = total > 0 ? completed / total : 0;
                const isToday = date === this.dataStore.getTodayStr();

                return `
                    <div class="week-day ${isToday ? 'active' : ''}">
                        <div class="week-day-name">周${dayNames[i]}</div>
                        <div class="week-day-date">${date.slice(8)}</div>
                        <div class="week-day-progress">${completed}/${total}</div>
                        <div class="week-day-bar">
                            <div class="week-day-bar-fill" style="width: ${rate * 100}%"></div>
                        </div>
                    </div>
                `;
            });

            weekGrid.innerHTML = (await Promise.all(dayPromises)).join('');
        } catch (e) {
            console.error('获取家长周视图失败:', e);
        }
    }

    async renderParentStats() {
        if (!this.selectedChild) return;
        await this.renderStats('week');
    }

    async renderParentAdvice() {
        if (!this.selectedChild) return;

        try {
            const advice = await this.adviceEngine.generateAdvice(this.selectedChild.id);
            document.getElementById('parent-advice-content').innerHTML = advice.map(a => `
                <div class="advice-card ${a.type}">
                    <div class="advice-title">
                        ${a.type === 'success' ? '✅' : a.type === 'warning' ? '⚠️' : '❌'}
                        ${a.title}
                    </div>
                    <div class="advice-content">${a.content}</div>
                    <div class="advice-meta">来源: ${a.source}</div>
                </div>
            `).join('');
        } catch (e) {
            console.error('获取家长建议失败:', e);
        }
    }

    // ==================== 设置 ====================
    openSettings() {
        document.getElementById('settings-modal').classList.remove('hidden');
        const user = this.dataStore.currentUser;
        if (user && user.role === 'student') {
            document.getElementById('parent-code-display').textContent = user.parentCode || 'N/A';
        }
    }

    closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    }

    async exportData() {
        try {
            const data = await this.dataStore.api.get('/api/data/export');
            const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `study-plan-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showNotification('数据已导出', 'success');
        } catch (e) {
            this.showNotification('导出失败', 'error');
        }
    }

    async importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                await this.dataStore.api.post('/api/data/import', { data });
                this.showNotification('数据导入成功', 'success');
                location.reload();
            } catch (e) {
                this.showNotification('数据格式错误', 'error');
            }
        };
        reader.readAsText(file);
    }

    updateDateDisplay() {
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        });
        document.getElementById('current-date').textContent = dateStr;
        const parentDate = document.getElementById('parent-current-date');
        if (parentDate) parentDate.textContent = dateStr;
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        container.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-20px)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    const api = new APIClient();
    const dataStore = new DataStore(api);
    const adviceEngine = new AIAdviceEngine(dataStore);
    window.ui = new UIController(dataStore, adviceEngine);
});
