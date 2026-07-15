import { TitleContext } from "@/App";
import { memo, useContext } from "react";

const TitlebarTitle = memo(function TitlebarTitle() {
  const { title } = useContext(TitleContext);
  return (
    <div className="title-bar-title">
      <span className="text">{title}</span>
    </div>
  );
});

export default TitlebarTitle;
