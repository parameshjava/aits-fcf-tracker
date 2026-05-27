"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-500" />,
        info: <InfoIcon className="size-4 text-sky-500" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-500" />,
        error: <OctagonXIcon className="size-4 text-rose-500" />,
        loading: (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group relative rounded-lg border border-border bg-popover/85 text-popover-foreground " +
            "shadow-lg backdrop-blur-md border-l-4 border-l-border pl-4 pr-10",
          title: "text-sm font-semibold leading-tight",
          description: "text-sm text-muted-foreground leading-snug",
          actionButton:
            "bg-primary text-primary-foreground hover:bg-primary/90",
          cancelButton: "bg-muted text-muted-foreground hover:bg-muted/80",
          success: "!border-l-emerald-500",
          info: "!border-l-sky-500",
          warning: "!border-l-amber-500",
          error: "!border-l-rose-500",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
