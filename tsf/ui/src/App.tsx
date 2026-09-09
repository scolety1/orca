import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommandDockProvider } from '@/lib/command-dock-context'
import { CommandConversationProvider } from '@/lib/command-conversation-context'
import { AppShell } from '@/components/AppShell'
import { HQPage } from '@/pages/HQPage'
import { CommandPage } from '@/pages/CommandPage'
import { WorkPage } from '@/pages/WorkPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ProjectDetailPage } from '@/pages/ProjectDetailPage'
import { AgentsPage } from '@/pages/AgentsPage'
import { AddProjectPage } from '@/pages/AddProjectPage'
import { EvaluationPage } from '@/pages/EvaluationPage'
import { FleetPage } from '@/pages/FleetPage'
import { HealthRepairCenterPage } from '@/pages/HealthRepairCenterPage'
import { MorePage } from '@/pages/MorePage'

// Operator IA consolidation V1: primary navigation is HQ/Work/Projects/More
// (see AppShell.tsx's NAV) -- every prior route stays mounted and reachable
// (deep links, bookmarks, and More's own links all still work) so this is
// a navigation change, not a capability removal.
export function App() {
  return (
    <TooltipProvider delayDuration={400}>
      {/* Global Command Dock V1: above the router so the dock's open state,
          conversation, and route context survive every navigation -- never
          re-created per route. Full Command Mode: CommandConversationProvider
          holds the actual conversation (messages/draft/attachments/etc, see
          its own header) so the dock's floating panel and the full-page
          /command view -- two separate CommandPanel mounts -- read and write
          the exact same state; collapsing one back into the other loses
          nothing. */}
      <CommandDockProvider>
        <CommandConversationProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<HQPage />} />
                <Route path="/command" element={<CommandPage />} />
                <Route path="/work" element={<WorkPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/add" element={<AddProjectPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/evaluation" element={<EvaluationPage />} />
                <Route path="/fleet" element={<FleetPage />} />
                <Route path="/health-repair" element={<HealthRepairCenterPage />} />
                <Route path="/more" element={<MorePage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </CommandConversationProvider>
      </CommandDockProvider>
    </TooltipProvider>
  )
}
