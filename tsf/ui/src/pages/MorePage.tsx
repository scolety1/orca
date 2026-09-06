import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, FlaskConical, MessageSquareText, Stethoscope, TerminalSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ADVANCED_SURFACES = [
  {
    to: '/fleet',
    icon: CalendarClock,
    title: 'Fleet',
    description: 'Build an overnight schedule across the Work Set -- concurrency, priorities, real capacity checks.'
  },
  {
    to: '/agents',
    icon: TerminalSquare,
    title: 'Agents',
    description: 'Per-project agent sessions and worktrees -- real, technical execution evidence.'
  },
  {
    to: '/evaluation',
    icon: FlaskConical,
    title: 'Evaluation',
    description: 'Run worker eval packs and check for quality regressions.'
  },
  {
    to: '/health-repair',
    icon: Stethoscope,
    title: 'Health Repair Center',
    description: 'Fleet-wide Health scan and bulk repair -- for a single project, use its own Health tab instead.'
  },
  {
    to: '/command',
    icon: MessageSquareText,
    title: 'Command (full page)',
    description: 'The Command composer also lives on HQ -- this is the same conversation, full-width.'
  }
]

// Operator IA consolidation: these surfaces keep every real capability
// (nothing here is removed or rewritten) -- only demoted from primary
// navigation into one obvious, advanced-user destination, per "Fleet
// membership/scheduling... an advanced management surface under More" and
// "Preserve [Agents/Evaluation/Fleet/diagnostics] under More/Advanced."
export function MorePage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">More</h1>
        <p className="text-sm text-muted-foreground">
          Advanced and internal surfaces -- fleet scheduling, agent sessions, evaluation, and fleet-wide Health Repair.
          Normal day-to-day work happens on HQ, Work, and Projects.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ADVANCED_SURFACES.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <Icon className="size-4 text-muted-foreground" />
                <CardTitle className="flex-1 text-sm">{title}</CardTitle>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{description}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
