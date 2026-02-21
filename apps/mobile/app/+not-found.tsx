import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';

export default function NotFoundScreen() {
  const { isAuthenticated } = useAuth();

  // If user is authenticated, redirect to home, otherwise to login
  return <Redirect href={isAuthenticated ? '/' : '/auth/login'} />;
}