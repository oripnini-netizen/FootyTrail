// src/components/Login.js
import React from 'react';
import { supabase } from '../supabase/client';

const Login = () => {
  const handleLoginWithProvider = async (provider) => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: 'http://localhost:3000/tutorial',
      },
    });
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '100px' }}>
      <h2>Login to FootyTrail</h2>
      <button onClick={() => handleLoginWithProvider('google')}>Login with Google</button>
      <br />
      <button onClick={() => handleLoginWithProvider('facebook')}>Login with Facebook</button>
    </div>
  );
};

export default Login;
