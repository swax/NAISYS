import { type IconProps,IconRobot, IconUser } from "@tabler/icons-react";
import React from "react";

interface AgentModelIconProps extends IconProps {
  shellModel?: string;
}

/** Icon representing an agent's shell model: person for "none" (human-driven), robot otherwise. */
export const AgentModelIcon: React.FC<AgentModelIconProps> = ({
  shellModel,
  ...iconProps
}) => {
  return shellModel === "none" ? (
    <IconUser {...iconProps} />
  ) : (
    <IconRobot {...iconProps} />
  );
};
