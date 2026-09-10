import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Box, CheckCheck, Eye, EyeOff, Loader2, LockKeyhole, ScanLine, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../api/api';
import './LoginPage.css';

export function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const submittingRef = useRef(false);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    // A ref also guards consecutive submissions before React updates the button.
    if (submittingRef.current) return;
    if (!username.trim() || !password) {
      setError('請填寫使用者名稱與密碼。');
      (!username.trim() ? usernameRef : passwordRef).current?.focus();
      return;
    }

    submittingRef.current = true;
    setError('');
    setIsLoggingIn(true);
    try {
      const response = await apiClient.post('/api/auth/login', { username, password });
      const responseData = response.data;
      toast.success(`歡迎回來，${responseData.user.name || responseData.user.username}！`);
      onLogin(responseData);
      navigate('/tasks');
    } catch (err) {
      setError(err.response?.data?.message || '暫時無法登入，請稍後再試。');
    } finally {
      submittingRef.current = false;
      setIsLoggingIn(false);
    }
  };

  return (
    <main className="corely-login">
      <div className="corely-login__shell">
        <header className="corely-login__header">
          <img className="corely-login__wordmark" src="/branding/corely-wordmark.png" alt="Corely AI" width="2172" height="724" />
          <span className="corely-login__company">Corely AI <span aria-hidden="true">/</span> WAREHOUSE OPERATIONS</span>
        </header>

        <div className="corely-login__content">
          <section className="corely-login__intro" aria-labelledby="corely-product-name">
            <p className="corely-login__eyebrow">讓出貨的最後一關，更安心</p>
            <h1 id="corely-product-name"><span className="corely-login__product-brand">Corely AI</span><span>儲運管理系統</span></h1>
            <p className="corely-login__description">從揀貨核對到裝箱驗證，<br />讓每一件商品、每一道步驟都清楚有序。</p>

            <div className="corely-login__visual" aria-hidden="true">
              <div className="corely-login__orbit corely-login__orbit--outer" />
              <div className="corely-login__orbit corely-login__orbit--inner" />
              <img className="corely-login__symbol" src="/branding/corely-symbol.png" alt="" width="1254" height="1254" />
              <div className="corely-login__visual-label"><ScanLine size={16} /> 每一次核對，都有跡可循</div>
            </div>

            <ol className="corely-login__workflow" aria-label="出貨作業流程">
              <li><ScanLine aria-hidden="true" size={19} /><span><small>01</small>揀貨核對</span></li>
              <li><Box aria-hidden="true" size={19} /><span><small>02</small>裝箱驗證</span></li>
              <li><CheckCheck aria-hidden="true" size={19} /><span><small>03</small>核對完成</span></li>
            </ol>
          </section>

          <section className="corely-login__access" aria-labelledby="corely-login-title">
            <div className="corely-login__card">
              <span className="corely-login__card-icon" aria-hidden="true"><LockKeyhole size={23} strokeWidth={1.7} /></span>
              <p className="corely-login__eyebrow">工作從這裡開始</p>
              <h2 id="corely-login-title">歡迎回來</h2>
              <p className="corely-login__form-description">登入您的帳號，接續今天的出貨任務。</p>

              <form onSubmit={handleSubmit} noValidate aria-busy={isLoggingIn}>
                <div className="corely-login__field">
                  <label htmlFor="corely-username">使用者名稱</label>
                  <div className="corely-login__input-wrap">
                    <UserRound size={18} aria-hidden="true" />
                    <input
                      ref={usernameRef}
                      id="corely-username"
                      name="username"
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="請輸入使用者名稱"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      disabled={isLoggingIn}
                      aria-describedby={error ? 'corely-login-error' : undefined}
                    />
                  </div>
                </div>
                <div className="corely-login__field">
                  <label htmlFor="corely-password">密碼</label>
                  <div className="corely-login__input-wrap">
                    <LockKeyhole size={18} aria-hidden="true" />
                    <input
                      ref={passwordRef}
                      id="corely-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="請輸入密碼"
                      autoComplete="current-password"
                      required
                      disabled={isLoggingIn}
                      aria-describedby={error ? 'corely-login-error' : undefined}
                    />
                    <button
                      className="corely-login__visibility"
                      type="button"
                      aria-label="顯示密碼"
                      aria-pressed={showPassword}
                      aria-controls="corely-password"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={isLoggingIn}
                    >
                      {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                {error && <div className="corely-login__error" id="corely-login-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}

                <button type="submit" className="corely-login__submit" disabled={isLoggingIn}>
                  {isLoggingIn ? <><Loader2 className="corely-login__spinner" size={19} aria-hidden="true" />登入中…</> : <>登入系統<ArrowRight size={19} aria-hidden="true" /></>}
                </button>
                <p className="corely-login__help">帳號或登入遇到問題，請聯繫系統管理員。</p>
              </form>

              <div className="corely-login__card-footer"><span className="corely-login__footer-mark" aria-hidden="true" />Corely AI 團隊作業空間</div>
            </div>
          </section>
        </div>

        <footer className="corely-login__footer"><span>© {new Date().getFullYear()} Corely AI</span><span>Design by Corely AI</span></footer>
      </div>
    </main>
  );
}
