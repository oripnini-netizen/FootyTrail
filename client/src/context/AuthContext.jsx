import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase'; // אתה אמרת שקובץ נקרא supabase.js

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const getSessionAndUser = async () => {
      setLoading(true);

      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUser = session?.user;

      if (supabaseUser) {
        // ננסה להביא את המשתמש מהטבלה שלנו
        const { data: existingUser, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', supabaseUser.id)
          .single();

        if (!existingUser && !error) {
          // משתמש חדש - יוצרים שורה בטבלת users
          const { data: insertedUser } = await supabase
            .from('users')
            .insert([{
              id: supabaseUser.id,
              email: supabaseUser.email,
              role: 'user',
              has_completed_onboarding: false,
            }])
            .select()
            .single();

          setUser(insertedUser);
        } else {
          setUser(existingUser);
        }
      } else {
        setUser(null);
      }

      setLoading(false);
    };

    getSessionAndUser();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      getSessionAndUser();
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const refresh = async () => {
    const { data: { user: freshUser } } = await supabase.auth.getUser();
    setUser(freshUser);
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
