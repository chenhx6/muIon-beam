cmake_minimum_required(VERSION 3.16...3.27)
project(muon_ne_stopping LANGUAGES CXX)

find_package(Geant4 11.3.2 CONFIG REQUIRED)
include(${Geant4_USE_FILE})

add_executable(mu_ne_stopping src/mu_ne_stopping.cc)
target_compile_features(mu_ne_stopping PRIVATE cxx_std_17)
target_link_libraries(mu_ne_stopping PRIVATE ${Geant4_LIBRARIES})

set_target_properties(mu_ne_stopping PROPERTIES
  CXX_EXTENSIONS OFF
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
