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
          /*
           * 注意：这里不能加 Tailwind 的 `group` 类。
           * `group-hover:` 编译成 `:is(:where(.group):hover *)`，只要祖先
           * 带 .group 且被 hover，整棵子树里所有 group-hover 都会亮起来——
           * 而 PanelGroup 是编辑器里最大的一棵子树。所以用具名 group。
           */
          "flex h-full w-full group/panels data-[panel-group-direction=vertical]:flex-col",
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
        "group-data-[resizing=true]/panels:transition-none",
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
      /*
       * 命中区比视觉线宽：细到 1px 很难按住，拖拽手感直接崩掉。
       * hitAreaMargins 把这 8px 扩展成不可见的热区，
       * 而视觉上仍然只有 1px 的线——默认那 4px 的实心条
       * 比面板自身的边框重两倍，夹在两个同样有边框的面板之间
       * 看着像多了一根结构件。
       */
      hitAreaMargins={{ coarse: 8, fine: 8 }}
      className={cn(
        "focus-visible:ring-ring group/resize relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        /*
         * 视觉线。
         *
         * 两侧面板不再各自画 border（否则会露出两条线，中间还夹着
         * handle 宽度形成的空隙），所以这条线是界面上唯一的分隔。
         * 它必须常驻可见，不能像之前那样"hover 才显形"——
         * 否则面板之间就没有边界了。
         * 常态半透明与面板边框同权重，hover/拖动时提亮，提示可拖。
         */
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:opacity-70 before:transition-opacity data-[panel-group-direction=vertical]:before:inset-x-0 data-[panel-group-direction=vertical]:before:top-1/2 data-[panel-group-direction=vertical]:before:left-0 data-[panel-group-direction=vertical]:before:h-px data-[panel-group-direction=vertical]:before:w-full data-[panel-group-direction=vertical]:before:-translate-y-1/2 data-[panel-group-direction=vertical]:before:translate-x-0 hover:before:opacity-100 data-[resize-handle-state=drag]:before:opacity-100",
        className
      )}
      {...props}
    >
      {withHandle && (
        /*
         * 抓手只在悬停/拖动时出现。
         * 常驻一个实心小方块会在安静的编辑界面里立一块视觉噪点，
         * 而"这里可以拖"这个信息在鼠标靠近之前并不需要被看见。
         */
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border opacity-0 transition-opacity group-hover/resize:opacity-100 data-[resize-handle-state=drag]/resize:opacity-100">
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
