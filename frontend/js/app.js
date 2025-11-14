// This file will hold the core application logic for the frontend.
// It will handle user authentication, file uploads, and displaying quizzes.

class SmartQuizApp {
    constructor() {
        this.state = {
            user: null,
            quizzes: [],
            pipelineLog: []
        };

    const fallbackLocalApi = 'http://localhost:8000/api';
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    this.apiBaseUrl = window.SMARTQUIZ_API_BASE_URL || (isLocalhost ? fallbackLocalApi : null);

        this.elements = {
            loginBtn: document.getElementById('login-btn'),
            logoutBtn: document.getElementById('logout-btn'),
            appContainer: document.getElementById('app-container'),
            authHint: document.getElementById('auth-hint'),
            uploadBtn: document.getElementById('upload-btn'),
            fileInput: document.getElementById('pdf-upload'),
            pipelineLog: document.getElementById('pipeline-log'),
            quizList: document.getElementById('quiz-list'),
            quizView: document.getElementById('quiz-view-section'),
            quizTitle: document.getElementById('quiz-title'),
            quizContent: document.getElementById('quiz-content'),
            backBtn: document.getElementById('back-to-quizzes-btn')
        };
    }

    init() {
    this.elements.loginBtn?.addEventListener('click', () => this.handleLogin());
    this.elements.logoutBtn?.addEventListener('click', () => this.handleLogout());
    this.elements.uploadBtn?.addEventListener('click', () => this.handleUpload());
    this.elements.backBtn?.addEventListener('click', () => this.hideQuizView());

        // Listen to file selection to update helper text/log
    this.elements.fileInput?.addEventListener('change', (event) => {
            const fileName = event.target.files?.[0]?.name;
            if (fileName) {
                this.appendLog(`Selected file: ${fileName}`);
            }
        });

        // Prefetch quizzes if running without auth
    this.fetchQuizzes();
    }

    handleLogin() {
        // TODO: integrate Firebase auth
        this.state.user = {
            displayName: 'Demo User',
            email: 'demo@smartquiz.app'
        };

        this.elements.loginBtn.style.display = 'none';
        this.elements.logoutBtn.style.display = 'inline-flex';
        this.elements.authHint.style.display = 'none';
        this.elements.appContainer.style.display = 'block';
        this.appendLog('User authenticated.');

        this.fetchQuizzes();
    }

    handleLogout() {
        this.state.user = null;
        this.elements.loginBtn.style.display = 'inline-flex';
        this.elements.logoutBtn.style.display = 'none';
        this.elements.authHint.style.display = 'block';
        this.elements.appContainer.style.display = 'none';
        this.appendLog('User signed out.');
    }

    handleUpload() {
        if (!this.state.user) {
            alert('Please sign in first.');
            return;
        }

        const file = this.elements.fileInput.files?.[0];
        if (!file) {
            alert('Select a PDF to continue.');
            return;
        }

        this.appendLog(`Uploading ${file.name} to SmartQuiz API…`);
        this.uploadToApi(file);
    }

    appendLog(message) {
        const timestamp = new Date().toLocaleTimeString();
        this.state.pipelineLog.push(`[${timestamp}] ${message}`);
        const log = this.state.pipelineLog.slice(-6).join('\n');
        this.elements.pipelineLog.textContent = log;
    }

    renderQuizList() {
        this.elements.quizList.innerHTML = '';
        if (!this.state.quizzes.length) {
            this.elements.quizList.innerHTML = '<p>No quizzes yet. Upload a PDF to generate one.</p>';
            return;
        }

        this.state.quizzes.forEach((quiz) => {
            const item = document.createElement('div');
            item.className = 'quiz-item';
            item.innerHTML = `
                <div>
                    <strong>${quiz.title}</strong>
                    <p>${quiz.questionCount || (quiz.questions?.length ?? 0)} questions</p>
                </div>
                <span>›</span>
            `;
            item.addEventListener('click', () => this.showQuizView(quiz));
            this.elements.quizList.appendChild(item);
        });
    }

    showQuizView(quiz) {
        const questions = quiz.questions || [];
        this.elements.quizView.style.display = 'block';
        this.elements.quizTitle.textContent = quiz.title;
        this.elements.quizContent.innerHTML = questions.length
            ? questions
                  .map((q, index) => `
                        <article>
                            <h4>Q${index + 1}. ${q.prompt || q.question}</h4>
                            <ul>
                                ${(q.choices || q.options || []).map((choice) => `<li>${choice}</li>`).join('')}
                            </ul>
                            <p><strong>Answer:</strong> ${q.answer || q.correctAnswer}</p>
                        </article>
                    `)
                  .join('')
            : '<p>Questions will appear here once the AI pipeline returns data.</p>';
    }

    hideQuizView() {
        this.elements.quizView.style.display = 'none';
    }
    async fetchQuizzes() {
        try {
            if (!this.apiBaseUrl) {
                this.appendLog('API base URL not configured for production. Set window.SMARTQUIZ_API_BASE_URL to your backend endpoint.');
                return;
            }

            const response = await fetch(`${this.apiBaseUrl}/quizzes`);
            if (!response.ok) {
                throw new Error('Failed to load quizzes');
            }
            const data = await response.json();
            this.state.quizzes = data;
            this.renderQuizList();
            this.appendLog('Quiz list synced with API.');
        } catch (error) {
            console.warn(error);
            if (!this.state.quizzes.length) {
                this.appendLog('Falling back to mock data. Start dev server for live quizzes.');
                this.state.quizzes = [];
                this.renderQuizList();
            }
        }
    }

    async uploadToApi(file) {
        if (!this.apiBaseUrl) {
            alert('Backend API endpoint is not configured for this environment.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${this.apiBaseUrl}/quizzes`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || 'Upload failed');
            }

            const quiz = await response.json();
            this.appendLog('Quiz generated successfully.');
            this.state.quizzes = [quiz, ...this.state.quizzes];
            this.renderQuizList();
            this.showQuizView(quiz);
        } catch (error) {
            console.error(error);
            alert('Upload failed. Is the backend dev server running on port 8000?');
            this.appendLog('Upload failed. Check console for details.');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new SmartQuizApp();
    app.init();
});
