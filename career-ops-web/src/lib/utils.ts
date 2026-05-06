import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function scoreColor(score: number): string {
  if (score >= 4.5) return 'text-green-600 bg-green-50'
  if (score >= 4.0) return 'text-blue-600 bg-blue-50'
  if (score >= 3.5) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

export function scoreLabel(score: number): string {
  if (score >= 4.5) return 'Strong match'
  if (score >= 4.0) return 'Good match'
  if (score >= 3.5) return 'Marginal'
  return 'Skip'
}
