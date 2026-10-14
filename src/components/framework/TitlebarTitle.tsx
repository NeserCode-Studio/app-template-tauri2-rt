import { TitleContext } from "@/contexts/title";
import { memo, useContext } from "react";

const TitlebarTitle = memo(function TitlebarTitle() {
  const { title } = useContext(TitleContext);
  return (
    // 绝对定位居中：窗口宽度变化时标题不会因左右两侧宽度不等而偏移
    <div className="pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 select-none truncate text-sm font-medium text-neutral-600 transition-colors duration-100 ease-in-out dark:text-neutral-200">
      {title}
    </div>
  );
});

export default TitlebarTitle;
