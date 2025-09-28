// Login form handler
document.getElementById('loginForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/dashboard-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include' // Important for cookies
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('loginMessage', 'Login successful', 'success');
            window.location.href = '../';
        } else {
            showMessage('loginMessage', data.error, 'error');
        }
    } catch (error) {
        showMessage('loginMessage', 'An error occurred', 'error');
    }
});

// Signup form handler
document.getElementById('signupForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    
    try {
        const response = await fetch('/dashboard-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
            credentials: 'include' // Important for cookies
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('signupMessage', 'Account created successfully', 'success');
            window.location.href = '../dashboard-login/';
        } else {
            showMessage('signupMessage', data.error, 'error');
        }
    } catch (error) {
        showMessage('signupMessage', 'An error occurred', 'error');
    }
});

// Dashboard page check
if (window.location.pathname.includes('dashboard.html')) {
    checkAuthStatus();
}

// Logout handler
document.getElementById('logoutBtn')?.addEventListener('click', async function() {
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            window.location.href = '/dashboard-login';
        }
    } catch (error) {
        console.error('Logout failed:', error);
    }
});

async function checkAuthStatus() {
    try {
        const response = await fetch('/dashboard', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            window.location.href = '/index.html';
            return;
        }
        
        const data = await response.json();
        displayUserInfo(data.user);
    } catch (error) {
        window.location.href = '/index.html';
    }
}

function displayUserInfo(user) {
    document.getElementById('userInfo').innerHTML = `
        <p><strong>Name:</strong> ${user.name}</p>
        <p><strong>Email:</strong> ${user.email}</p>
    `;
}

function showMessage(elementId, message, type) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.className = `message ${type}`;
}