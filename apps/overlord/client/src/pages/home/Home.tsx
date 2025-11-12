import React from "react";
import { Hello } from "./Hello";

export const Home: React.FC = () => {
  return (
    <div>
      <h1>Full Stack TypeScript App</h1>
      <p>
        Welcome to your new Node.js/Fastify + React/Vite application with
        TypeScript!
      </p>
      <Hello />
    </div>
  );
};
