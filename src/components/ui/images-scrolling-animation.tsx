"use client"

import { motion, useScroll, useTransform, type MotionValue } from "framer-motion"
import ReactLenis from "lenis/react"
import { ImageIcon } from "lucide-react"
import { useRef, type ReactNode } from "react"

export interface ImageScrollingProject {
  id?: string
  title: string
  src: string
}

export const defaultImageScrollingProjects: ImageScrollingProject[] = [
  {
    title: "Project 1",
    src: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=500&h=300&fit=crop&crop=center",
  },
  {
    title: "Project 2",
    src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=500&h=300&fit=crop&crop=center",
  },
  {
    title: "Project 3",
    src: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=500&h=300&fit=crop&crop=center",
  },
  {
    title: "Project 4",
    src: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=500&h=300&fit=crop&crop=center",
  },
  {
    title: "Project 5",
    src: "https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=500&h=300&fit=crop&crop=center",
  },
]

interface StickyCardProps {
  i: number
  title: string
  src: string
  progress: MotionValue<number>
  range: [number, number]
  targetScale: number
  compact?: boolean
  active?: boolean
  children?: ReactNode
  onClick?: () => void
}

const StickyCard_001 = ({
  i,
  title,
  src,
  progress,
  range,
  targetScale,
  compact = false,
  active = false,
  children,
  onClick,
}: StickyCardProps) => {
  const container = useRef<HTMLDivElement>(null)
  const scale = useTransform(progress, range, [1, targetScale])
  const top = compact ? `${8 + Math.min(i, 10) * 5}px` : `calc(-5vh + ${i * 15 + 200}px)`

  const media = (
    <>
      {src ? (
        <img src={src} alt={title} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-ds-subtle text-ds-muted">
          <ImageIcon aria-hidden="true" className="h-6 w-6" />
        </span>
      )}
      {children}
    </>
  )

  return (
    <div
      ref={container}
      className={compact ? "sticky top-0 flex min-h-32 items-start justify-center px-1" : "sticky top-0 flex items-center justify-center px-4 sm:px-6 lg:px-8"}
    >
      <motion.div
        style={{ scale, top }}
        className={`${compact
          ? "relative h-28 w-full origin-top overflow-hidden rounded-xl border bg-ds-subtle shadow-sm"
          : "relative -top-1/4 flex h-[200px] w-[280px] origin-top flex-col overflow-hidden rounded-2xl sm:h-[240px] sm:w-[360px] sm:rounded-3xl md:h-[280px] md:w-[420px] lg:h-[300px] lg:w-[500px]"
        } ${active ? "border-ds-selection-border ring-2 ring-inset ring-ds-selection-border" : "border-ds-border"}`}
      >
        {onClick ? (
          <button
            type="button"
            aria-current={active ? "location" : undefined}
            aria-label={`定位到任务：${title}`}
            className="relative block h-full w-full overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-primary"
            onClick={onClick}
          >
            {media}
          </button>
        ) : media}
      </motion.div>
    </div>
  )
}

interface ImagesScrollingAnimationProps {
  projects?: ImageScrollingProject[]
}

const ImagesScrollingAnimation = ({ projects = defaultImageScrollingProjects }: ImagesScrollingAnimationProps) => {
  const container = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: container,
    offset: ["start start", "end end"],
  })

  return (
    <ReactLenis root>
      <main
        ref={container}
        className="relative flex w-full flex-col items-center justify-center pb-[50vh] pt-[5vh] sm:pb-[60vh] sm:pt-[8vh] lg:pb-[70vh] lg:pt-[10vh]"
      >
        {projects.map((project, i) => {
          const targetScale = Math.max(0.6, 1 - (projects.length - i - 1) * 0.08)
          return (
            <StickyCard_001
              key={project.id ?? `p_${i}`}
              i={i}
              {...project}
              progress={scrollYProgress}
              range={[i * 0.2, 1]}
              targetScale={targetScale}
            />
          )
        })}
      </main>
    </ReactLenis>
  )
}

export { ImagesScrollingAnimation, StickyCard_001 }
