import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../App';

test('renders ArbBot Pro text', () => {
  render(<App />);
  expect(screen.getByText(/ArbBot Pro/i)).toBeInTheDocument();
});
