cmake_minimum_required(VERSION 3.16...3.27)
project(muion_geant4_mvp_smoke LANGUAGES CXX)

find_package(Geant4 11.0 CONFIG REQUIRED)
include(${Geant4_USE_FILE})

add_executable(g4_mvp_smoke main.cc)
target_compile_features(g4_mvp_smoke PRIVATE cxx_std_17)
target_link_libraries(g4_mvp_smoke PRIVATE ${Geant4_LIBRARIES})
target_compile_definitions(g4_mvp_smoke PRIVATE G4_MVP_GEANT4_VERSION=\"${Geant4_VERSION}\")
set_target_properties(g4_mvp_smoke PROPERTIES CXX_EXTENSIONS OFF RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
