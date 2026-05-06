import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Search,
  User,
  Bell,
  LogOut,
  Briefcase,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext.tsx'
import { cn } from '@/lib/utils.ts'

const navItems = [
  { to: '/pipeline', icon: LayoutDashboard, label: 'Pipeline' },
  { to: '/portals', icon: Search, label: 'Portals' },
  { to: '/reports', icon: FileText, label: 'Reports' },
  { to: '/followups', icon: Bell, label: 'Follow-ups' },
  { to: '/profile', icon: User, label: 'Profile' },
]

export function Sidebar() {
  const { user, signOut } = useAuth()

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4">
        <Briefcase className="h-5 w-5 text-blue-600" />
        <span className="font-semibold text-gray-900">Career-Ops</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-3">
        <div className="mb-2 px-3 py-1">
          <p className="truncate text-xs text-gray-500">{user?.email}</p>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
