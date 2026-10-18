import * as React from "react"
import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"
import type { ImperativePanelHandle } from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * 拖拽状态广播。
 *
 * 面板宽度过渡要能在拖拽期间关掉（否则面板追不上指针），而
 * PanelGroup / PanelResizeHandle 是彼此独立的兄弟组件，没有直接通信渠道。
 * 用一个 context 把"正在拖拽"从 handle 送到 group，再由 group 打成
 * data-resizing 属性，面板用 group-data 选择器关掉过渡。
 */
const ResizingContext = React.createContext<
  (dragging: boolean) => void
>(() => () => {})

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  const [resizing, setResizing] = React.useState(false)
  const setDragging = React.useCallback(
    (dragging: boolean) => setResizing(dragging),
    []
  )

  return (
    <ResizingContext.Provider value={setDragging}>
      <ResizablePrimitive.PanelGroup
        data-slot="resizable-panel-group"
        data-resizing={resizing ? "true" : undefined}
        className={cn(
          "group flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
          className
        )}
        {...props}
      />
    </ResizingContext.Provider>
  )
}

const ResizablePanel = React.forwardRef<
  ImperativePanelHandle,
  React.ComponentProps<typeof ResizablePrimitive.Panel>
>(function ResizablePanel({ ...props }, ref) {
  return (
    <ResizablePrimitive.Panel
      ref={ref}
      data-slot="resizable-panel"
      /*
       * 面板宽高的过渡。
       *
       * 库把 flex-grow 写成 inline style，且默认没有任何过渡，
       * 于是 collapse()/expand() 是瞬间跳变——按钮一点宽度就变了，
       * 和拖拽调宽的手感也对不上。这里补一段 transition。
       *
       * 拖拽期间必须关掉：库是按指针位置连续改 flex-grow 的，
       * 若同时跑过渡，面板会追不上指针，手感发黏。
       * 库会给正在拖拽的 handle 打上 data-resize-handle-active，
       * CSS 选中它即可，无需在 React 里同步拖拽状态。
       */
      className={cn(
        "transition-[flex-grow] duration-200 ease-out",
        "group-data-[resizing=true]/group:transition-none",
        props.className
      )}
      {...props}
    />
  )
})

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) {
  const setDragging = React.useContext(ResizingContext)

  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      onDragging={setDragging}
      className={cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type ImperativePanelHandle,
}
