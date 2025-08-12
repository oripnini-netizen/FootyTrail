import { supabase } from '../services/supabaseClient.js';

export const signUpUser = async (req, res) => {
  const { email, password, full_name } = req.body;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
      },
    },
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'User signed up', user: data.user });
};

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'User logged in', user: data.user, token: data.session.access_token });
};
