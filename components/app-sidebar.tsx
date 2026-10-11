import type { User } from '@supabase/supabase-js'
import type { ComponentProps } from 'react'
import { BookOpenText, Library, NotebookPen, Search, Sparkles, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { NavUser } from '@/components/nav-user'

interface AppSidebarProps extends ComponentProps<typeof Sidebar> {
  user: User | null
  onSignOut: () => Promise<void>
}

const navigation: { title: string; url: string; icon: LucideIcon }[] = [
  { title: 'Library', url: '/', icon: Library },
  { title: 'Reader', url: '/reader', icon: BookOpenText },
  { title: 'Search', url: '/search', icon: Search },
  { title: 'Notes', url: '/notes', icon: NotebookPen },
]

export function AppSidebar({ user, onSignOut, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Knowledge Workspace">
              <div className="flex aspect-square size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Sparkles className="size-[18px]" />
              </div>
              <div className="grid flex-1 text-left text-[15px] leading-tight">
                <span className="truncate font-medium">Knowledge Workspace</span>
                <span className="truncate text-xs">Private research library</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    className="h-9 text-[15px] [&>svg]:size-[18px]"
                  >
                    <NavLink to={item.url} end={item.url === '/'}>
                      <item.icon />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onSignOut={onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
